import { describe, it, expect } from 'vitest';
import { isImageRequest, modelNamesMatch, isLikelyImageModelName, estimateJsonBytes } from '../../utils/files';

describe('isImageRequest', () => {
  it('detects explicit slash commands', () => {
    expect(isImageRequest('/image a cat')).toBe(true);
    expect(isImageRequest('/draw a sunset')).toBe(true);
    expect(isImageRequest('/img logo')).toBe(true);
  });

  it('detects natural language image requests', () => {
    expect(isImageRequest('generate an image of a mountain')).toBe(true);
    expect(isImageRequest('draw me a dragon')).toBe(true);
    expect(isImageRequest('create a picture of a dog')).toBe(true);
    expect(isImageRequest('paint a landscape')).toBe(true);
    expect(isImageRequest('show me a photo of Paris')).toBe(true);
    expect(isImageRequest('can you draw a cat?')).toBe(true);
    expect(isImageRequest('I want a picture of a sunset')).toBe(true);
  });

  it('does not flag normal chat messages', () => {
    expect(isImageRequest('hello world')).toBe(false);
    expect(isImageRequest('what is the capital of France?')).toBe(false);
    expect(isImageRequest('explain quantum physics')).toBe(false);
    expect(isImageRequest('write me a poem')).toBe(false);
  });
});

describe('modelNamesMatch', () => {
  it('matches identical names', () => {
    expect(modelNamesMatch('llama3', 'llama3')).toBe(true);
  });

  it('matches with :latest suffix', () => {
    expect(modelNamesMatch('llama3:latest', 'llama3')).toBe(true);
    expect(modelNamesMatch('llama3', 'llama3:latest')).toBe(true);
  });

  it('is case insensitive', () => {
    expect(modelNamesMatch('Llama3', 'llama3')).toBe(true);
  });

  it('does not match different models', () => {
    expect(modelNamesMatch('llama3', 'mistral')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(modelNamesMatch('', 'llama3')).toBe(false);
    expect(modelNamesMatch('llama3', '')).toBe(false);
  });
});

describe('isLikelyImageModelName', () => {
  it('identifies known image models', () => {
    expect(isLikelyImageModelName('x/z-image-turbo')).toBe(true);
    expect(isLikelyImageModelName('x/flux2-klein')).toBe(true);
  });

  it('identifies models with image-related keywords', () => {
    expect(isLikelyImageModelName('some/stable-diffusion-model')).toBe(true);
    expect(isLikelyImageModelName('image-gen-v2')).toBe(true);
  });

  it('does not flag chat models', () => {
    expect(isLikelyImageModelName('llama3')).toBe(false);
    expect(isLikelyImageModelName('mistral')).toBe(false);
    expect(isLikelyImageModelName('gemma:2b')).toBe(false);
  });

  it('handles empty string', () => {
    expect(isLikelyImageModelName('')).toBe(false);
  });
});

describe('estimateJsonBytes', () => {
  it('returns positive size for non-empty data', () => {
    expect(estimateJsonBytes({ a: 1 })).toBeGreaterThan(0);
  });

  it('returns larger size for larger data', () => {
    const small = estimateJsonBytes({ a: 1 });
    const large = estimateJsonBytes({ a: 'x'.repeat(1000) });
    expect(large).toBeGreaterThan(small);
  });
});
