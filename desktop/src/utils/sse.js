export function consumeSSEChunk(chunkText, state = {}) {
  let buffer = `${state.buffer || ''}${chunkText || ''}`;
  let eventData = state.eventData || '';
  const events = [];

  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? '';

  for (const line of lines) {
    if (line === '') {
      if (eventData) {
        events.push(eventData);
        eventData = '';
      }
      continue;
    }

    if (line.startsWith('data:')) {
      eventData += line.slice(5).trimStart();
    }
  }

  return {
    events,
    state: { buffer, eventData },
  };
}

export function flushSSEState(state = {}) {
  let buffer = state.buffer || '';
  let eventData = state.eventData || '';
  const events = [];

  if (buffer.startsWith('data:')) {
    eventData += buffer.slice(5).trimStart();
    buffer = '';
  }

  if (eventData) {
    events.push(eventData);
  }

  return {
    events,
    state: { buffer: '', eventData: '' },
  };
}
