import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Mock sessionStorage and localStorage
const mockStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'sessionStorage', { value: mockStorage });
Object.defineProperty(window, 'localStorage', { value: mockStorage });

// Mock indexedDB as not available so storage falls back to localStorage
Object.defineProperty(window, 'indexedDB', { value: undefined });

// Suppress console.error/warn for cleaner test output (opt-in)
// vi.spyOn(console, 'error').mockImplementation(() => {});
