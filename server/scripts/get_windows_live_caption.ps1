param(
  [string]$AutomationId = "CaptionsTextBlock",
  [switch]$Watch,
  [int]$IntervalMs = 700
)

$ErrorActionPreference = "Stop"

function Escape-JsonString([string]$value) {
  if ($null -eq $value) { return "" }
  return $value.Replace('\', '\\').Replace('"', '\"').Replace("`r", " ").Replace("`n", " ")
}

function Emit-Json([bool]$ok, [string]$status, [string]$text, [string]$error = "") {
  $payload = '{"ok":' + ($(if ($ok) { 'true' } else { 'false' })) + ',"status":"' + (Escape-JsonString $status) + '","text":"' + (Escape-JsonString $text) + '"'
  if (-not [string]::IsNullOrWhiteSpace($error)) {
    $payload += ',"error":"' + (Escape-JsonString $error) + '"'
  }
  $payload += '}'
  Write-Output $payload
}

function Normalize-Text([string]$raw) {
  if ([string]::IsNullOrWhiteSpace($raw)) { return "" }
  return ($raw -replace '\s+', ' ').Trim()
}

function Is-IgnoredCaptionText([string]$text) {
  $name = Normalize-Text($text)
  if ([string]::IsNullOrWhiteSpace($name)) { return $true }
  if ($name.Length -lt 2) { return $true }
  if ($name.Length -gt 240) { return $true }
  if ($name -match '^(Live captions|Captions|Settings|Close|Back|Feedback|字幕|设置|關閉|返回)$') { return $true }
  if ($name -match '(?i)address and search bar|search or type url|ready to show live captions|livecaptions-translator|sakirinn/livecaptions-translator') { return $true }
  if ($name -match '(?i)\bat master\b.*livecaptions-translator') { return $true }
  $wordCount = ($name -split '\s+').Count
  if ($wordCount -gt 42) { return $true }
  $sentenceMarks = ([regex]::Matches($name, '[.!?。！？]')).Count
  if ($sentenceMarks -gt 4) { return $true }
  return $false
}

function Get-WindowByProcessId([System.Windows.Automation.AutomationElement]$root, [System.Diagnostics.Process]$process) {
  if ($null -eq $process) { return $null }

  try {
    $mainHandle = [IntPtr]$process.MainWindowHandle
    if ($mainHandle -ne [IntPtr]::Zero) {
      $window = [System.Windows.Automation.AutomationElement]::FromHandle($mainHandle)
      if ($null -ne $window) { return $window }
    }
  } catch {
    # Continue to fallback.
  }

  $procCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    [int]$process.Id
  )
  $windowTypeCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window
  )
  $windowCondition = New-Object System.Windows.Automation.AndCondition($procCondition, $windowTypeCondition)

  $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $windowCondition)
  if ($null -ne $window) { return $window }
  return $null
}

function Get-NodeCandidateTexts([System.Windows.Automation.AutomationElement]$node) {
  if ($null -eq $node) { return @() }

  $results = New-Object System.Collections.Generic.List[string]

  $name = Normalize-Text([string]$node.Current.Name)
  if (-not [string]::IsNullOrWhiteSpace($name)) { [void]$results.Add($name) }

  $helpText = Normalize-Text([string]$node.Current.HelpText)
  if (-not [string]::IsNullOrWhiteSpace($helpText)) { [void]$results.Add($helpText) }

  try {
    $valueObj = $null
    if ($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valueObj)) {
      $valueText = Normalize-Text([string]$valueObj.Current.Value)
      if (-not [string]::IsNullOrWhiteSpace($valueText)) { [void]$results.Add($valueText) }
    }
  } catch {}

  try {
    $legacyObj = $null
    if ($node.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyObj)) {
      $legacyName = Normalize-Text([string]$legacyObj.Current.Name)
      if (-not [string]::IsNullOrWhiteSpace($legacyName)) { [void]$results.Add($legacyName) }
      $legacyValue = Normalize-Text([string]$legacyObj.Current.Value)
      if (-not [string]::IsNullOrWhiteSpace($legacyValue)) { [void]$results.Add($legacyValue) }
    }
  } catch {}

  try {
    $textObj = $null
    if ($node.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textObj)) {
      $rawText = [string]$textObj.DocumentRange.GetText(-1)
      $textValue = Normalize-Text($rawText)
      if (-not [string]::IsNullOrWhiteSpace($textValue)) { [void]$results.Add($textValue) }
    }
  } catch {}

  return $results | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
}

function Find-FirstCaptionByAutomationIds(
  [System.Windows.Automation.AutomationElement]$scopeNode,
  [string]$primaryAutomationId
) {
  if ($null -eq $scopeNode) { return "" }
  $automationIds = @($primaryAutomationId, "CaptionTextBlock", "CaptionsText", "CaptionText", "LiveCaptionsTextBlock") |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -Unique

  foreach ($candidateId in $automationIds) {
    $idCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      $candidateId
    )
    $node = $scopeNode.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $idCondition)
    if ($null -eq $node) { continue }

    $candidateTexts = Get-NodeCandidateTexts($node)
    foreach ($candidate in $candidateTexts) {
      if (-not (Is-IgnoredCaptionText($candidate))) {
        return $candidate
      }
    }
  }

  return ""
}

function Find-CaptionWindowsByTitle([System.Windows.Automation.AutomationElement]$root) {
  if ($null -eq $root) { return @() }
  $windows = @()
  $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  if ($null -eq $children -or $children.Count -le 0) { return @() }

  for ($i = 0; $i -lt $children.Count; $i++) {
    try {
      $title = Normalize-Text([string]$children[$i].Current.Name)
      if ([string]::IsNullOrWhiteSpace($title)) { continue }
      if ($title -match '(?i)^live captions$|^实时字幕$|^即時字幕$|^字幕$') {
        $windows += $children[$i]
      }
    } catch {
      # ignore inaccessible windows
    }
  }

  return $windows
}

function Extract-CaptionText([System.Windows.Automation.AutomationElement]$window, [string]$automationId) {
  if ($null -eq $window) { return "" }

  $directText = Find-FirstCaptionByAutomationIds -scopeNode $window -primaryAutomationId $automationId
  if (-not [string]::IsNullOrWhiteSpace($directText)) {
    return $directText
  }

  $textCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text
  )
  $documentCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Document
  )
  $editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $orCondition = New-Object System.Windows.Automation.OrCondition(
    (New-Object System.Windows.Automation.OrCondition($textCondition, $documentCondition)),
    $editCondition
  )

  $nodes = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $orCondition)
  if ($null -eq $nodes -or $nodes.Count -le 0) { return "" }

  $candidates = @()
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $candidateTexts = Get-NodeCandidateTexts($nodes[$i])
    foreach ($candidate in $candidateTexts) {
      if (Is-IgnoredCaptionText($candidate)) { continue }
      $candidates += $candidate
    }
  }

  if ($candidates.Count -eq 0) { return "" }
  return ($candidates | Sort-Object { $_.Length } -Descending | Select-Object -First 1)
}

function Invoke-CaptionProbe(
  [System.Windows.Automation.AutomationElement]$root,
  [string]$automationId
) {
  $processes = @(Get-Process -Name LiveCaptions -ErrorAction SilentlyContinue)
  if ($processes.Count -eq 0) {
    $processes = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ProcessName -like "*LiveCaption*"
    })
  }

  if ($processes.Count -eq 0) {
    return @{
      ok = $false
      status = "not_running"
      text = ""
      error = ""
    }
  }

  $window = $null
  for ($p = 0; $p -lt $processes.Count; $p++) {
    $window = Get-WindowByProcessId -root $root -process $processes[$p]
    if ($null -ne $window) { break }
  }

  if ($null -eq $window) {
    return @{
      ok = $false
      status = "window_not_found"
      text = ""
      error = ""
    }
  }

  $text = Extract-CaptionText -window $window -automationId $automationId
  if ([string]::IsNullOrWhiteSpace($text)) {
    $titleWindows = Find-CaptionWindowsByTitle -root $root
    for ($w = 0; $w -lt $titleWindows.Count; $w++) {
      $candidate = Extract-CaptionText -window $titleWindows[$w] -automationId $automationId
      if (-not [string]::IsNullOrWhiteSpace($candidate) -and -not (Is-IgnoredCaptionText($candidate))) {
        $text = $candidate
        break
      }
    }
  }

  if ([string]::IsNullOrWhiteSpace($text)) {
    return @{
      ok = $false
      status = "captions_not_found"
      text = ""
      error = ""
    }
  }

  return @{
    ok = $true
    status = "ok"
    text = $text
    error = ""
  }
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  Emit-Json -ok $false -status "error" -text "" -error ([string]$_.Exception.Message)
  exit 1
}

$root = [System.Windows.Automation.AutomationElement]::RootElement

if ($Watch) {
  $safeInterval = [Math]::Max(250, $IntervalMs)
  while ($true) {
    try {
      $result = Invoke-CaptionProbe -root $root -automationId $AutomationId
      Emit-Json -ok ([bool]$result.ok) -status ([string]$result.status) -text ([string]$result.text) -error ([string]$result.error)
    } catch {
      Emit-Json -ok $false -status "error" -text "" -error ([string]$_.Exception.Message)
    }
    Start-Sleep -Milliseconds $safeInterval
  }
}

try {
  $result = Invoke-CaptionProbe -root $root -automationId $AutomationId
  Emit-Json -ok ([bool]$result.ok) -status ([string]$result.status) -text ([string]$result.text) -error ([string]$result.error)
  if ($result.ok) {
    exit 0
  }
  if (@("not_running", "window_not_found", "captions_not_found") -contains [string]$result.status) {
    exit 0
  }
  exit 1
} catch {
  Emit-Json -ok $false -status "error" -text "" -error ([string]$_.Exception.Message)
  exit 1
}
