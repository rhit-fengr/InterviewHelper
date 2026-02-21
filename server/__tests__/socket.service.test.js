'use strict';

const { initSocketServer } = require('../services/socket.service');

describe('socket.service module', () => {
  it('exports initSocketServer function', () => {
    expect(typeof initSocketServer).toBe('function');
  });
});
