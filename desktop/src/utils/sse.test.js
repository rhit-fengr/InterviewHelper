import { consumeSSEChunk, flushSSEState } from './sse';

describe('SSE parser utils', () => {
  it('parses complete data events from a single chunk', () => {
    const input = 'data: {"text":"Hello"}\n\ndata: {"done":true}\n\n';
    const parsed = consumeSSEChunk(input, {});

    expect(parsed.events).toEqual(['{"text":"Hello"}', '{"done":true}']);
    expect(parsed.state).toEqual({ buffer: '', eventData: '' });
  });

  it('parses event data split across multiple chunks', () => {
    const part1 = consumeSSEChunk('data: {"text":"Hel', {});
    const part2 = consumeSSEChunk('lo"}\n\n', part1.state);

    expect(part1.events).toEqual([]);
    expect(part2.events).toEqual(['{"text":"Hello"}']);
  });

  it('supports multiple data lines in one event', () => {
    const parsed = consumeSSEChunk('data: {"text":"Hello"\ndata: ,"done":false}\n\n', {});
    expect(parsed.events).toEqual(['{"text":"Hello","done":false}']);
  });

  it('flushes trailing event data when stream closes without final delimiter', () => {
    const partial = consumeSSEChunk('data: {"text":"Done"}', {});
    const flushed = flushSSEState(partial.state);

    expect(partial.events).toEqual([]);
    expect(flushed.events).toEqual(['{"text":"Done"}']);
    expect(flushed.state).toEqual({ buffer: '', eventData: '' });
  });
});
