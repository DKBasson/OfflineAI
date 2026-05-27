import { describe, it, expect } from 'vitest';
import { normalizeSettings, loadSettings, saveSettings } from '../../utils/storage';
import { DEFAULT_SETTINGS } from '../../constants';

describe('normalizeSettings', () => {
  it('returns defaults when passed empty object', () => {
    const s = normalizeSettings({});
    expect(s.model).toBe(DEFAULT_SETTINGS.model);
    expect(s.contextSize).toBe(DEFAULT_SETTINGS.contextSize);
    expect(s.autoTitle).toBe(true);
  });

  it('clamps contextSize to valid range', () => {
    expect(normalizeSettings({ contextSize: 2 }).contextSize).toBe(4);
    expect(normalizeSettings({ contextSize: 200 }).contextSize).toBe(100);
    expect(normalizeSettings({ contextSize: 20 }).contextSize).toBe(20);
  });

  it('clamps temperature to 0–2', () => {
    expect(normalizeSettings({ temperature: -1 }).temperature).toBe(0);
    expect(normalizeSettings({ temperature: 5 }).temperature).toBe(2);
    expect(normalizeSettings({ temperature: 0.7 }).temperature).toBe(0.7);
  });

  it('clamps topP to 0.1–1', () => {
    expect(normalizeSettings({ topP: 0 }).topP).toBe(0.1);
    expect(normalizeSettings({ topP: 2 }).topP).toBe(1);
  });

  it('defaults imagePerfProfile to eco for invalid value', () => {
    expect(normalizeSettings({ imagePerfProfile: 'ultra' as never }).imagePerfProfile).toBe('eco');
  });

  it('accepts valid imagePerfProfile values', () => {
    expect(normalizeSettings({ imagePerfProfile: 'balanced' }).imagePerfProfile).toBe('balanced');
    expect(normalizeSettings({ imagePerfProfile: 'quality' }).imagePerfProfile).toBe('quality');
  });

  it('truncates username to 32 characters', () => {
    const long = 'a'.repeat(50);
    expect(normalizeSettings({ username: long }).username).toHaveLength(32);
  });

  it('forces autoTitle to true when undefined', () => {
    expect(normalizeSettings({}).autoTitle).toBe(true);
  });

  it('respects autoTitle: false', () => {
    expect(normalizeSettings({ autoTitle: false }).autoTitle).toBe(false);
  });
});

describe('loadSettings / saveSettings', () => {
  it('returns defaults when localStorage is empty', () => {
    localStorage.clear();
    const s = loadSettings();
    expect(s).toMatchObject(DEFAULT_SETTINGS);
  });

  it('roundtrips settings through localStorage', () => {
    const custom = normalizeSettings({ username: 'Alice', contextSize: 30 });
    saveSettings(custom);
    const loaded = loadSettings();
    expect(loaded.username).toBe('Alice');
    expect(loaded.contextSize).toBe(30);
  });
});
