param(
  [string]$AutomationId = "CaptionsTextBlock"
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

function Get-WindowByProcessId([System.Windows.Automation.AutomationElement]$root, [int]$processId) {
  $procCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    $processId
  )
  $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $procCondition)
  if ($null -ne $window) { return $window }
  return $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $procCondition)
}

function Normalize-Text([string]$raw) {
  if ([string]::IsNullOrWhiteSpace($raw)) { return "" }
  return ($raw -replace '\s+', ' ').Trim()
}

function Extract-CaptionText([System.Windows.Automation.AutomationElement]$window, [string]$automationId) {
  if ($null -eq $window) { return "" }

  $idCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    $automationId
  )
  $directNode = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $idCondition)
  if ($null -ne $directNode) {
    $directText = Normalize-Text([string]$directNode.Current.Name)
    if (-not [string]::IsNullOrWhiteSpace($directText)) {
      return $directText
    }
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
    $name = Normalize-Text([string]$nodes[$i].Current.Name)
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    if ($name.Length -lt 2) { continue }
    if ($name -match '^(Live captions|Captions|Settings|Close|Back|Feedback|字幕|设置|關閉|返回)$') { continue }
    $candidates += $name
  }

  if ($candidates.Count -eq 0) { return "" }
  return ($candidates | Sort-Object { $_.Length } -Descending | Select-Object -First 1)
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes

  $root = [System.Windows.Automation.AutomationElement]::RootElement

  $process = Get-Process -Name LiveCaptions -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $process) {
    $process = Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ProcessName -like "*LiveCaption*"
    } | Select-Object -First 1
  }

  $window = $null
  if ($null -ne $process) {
    $window = Get-WindowByProcessId -root $root -processId ([int]$process.Id)
  }

  if ($null -eq $window) {
    $allWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $allWindows.Count; $i++) {
      $title = Normalize-Text([string]$allWindows[$i].Current.Name)
      if ($title -match '(?i)live captions|captions|字幕') {
        $window = $allWindows[$i]
        break
      }
    }
  }

  if ($null -eq $window -and $null -eq $process) {
    Emit-Json -ok $false -status "not_running" -text ""
    exit 0
  }

  if ($null -eq $window) {
    Emit-Json -ok $false -status "window_not_found" -text ""
    exit 0
  }

  $text = Extract-CaptionText -window $window -automationId $AutomationId
  if ([string]::IsNullOrWhiteSpace($text)) {
    Emit-Json -ok $false -status "captions_not_found" -text ""
    exit 0
  }

  Emit-Json -ok $true -status "ok" -text $text
  exit 0
}
catch {
  $message = [string]$_.Exception.Message
  Emit-Json -ok $false -status "error" -text "" -error $message
  exit 1
}
