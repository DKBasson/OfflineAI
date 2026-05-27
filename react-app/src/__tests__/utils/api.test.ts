import { describe, it, expect, beforeEach } from 'vitest';
import { authHeaders } from '../../utils/api';

// Mock sessionStorage access via the AUTH_TOKEN_KEY constant
const AUTH_TOKEN_KEY = 'offlineai_auth_token';

describe('authHeaders', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns empty headers when no token set', () => {
    const headers = authHeaders();
    expect(headers).toEqual({});
  });

  it('merges extra headers without token', () => {
    const headers = authHeaders({ 'Content-Type': 'application/json' });
    expect(headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('adds auth token header when token is stored', () => {
    sessionStorage.setItem(AUTH_TOKEN_KEY, 'test-token-123');
    const headers = authHeaders();
    expect(headers['X-OfflineAI-Token']).toBe('test-token-123');
  });

  it('merges auth token with extra headers', () => {
    sessionStorage.setItem(AUTH_TOKEN_KEY, 'abc');
    const headers = authHeaders({ 'Content-Type': 'application/json' });
    expect(headers['X-OfflineAI-Token']).toBe('abc');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
