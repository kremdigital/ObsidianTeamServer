// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TEXT_KEY, buildInitialState, hashText } from './persistence';

describe('buildInitialState', () => {
  it('encodes a Y.Doc that decodes back to the same text', () => {
    const { state } = buildInitialState('# Заголовок\nТекст');
    const restored = new Y.Doc();
    Y.applyUpdate(restored, state);
    expect(restored.getText(TEXT_KEY).toString()).toBe('# Заголовок\nТекст');
  });

  it('hashText is stable for the same input', () => {
    expect(hashText('hello')).toBe(hashText('hello'));
    expect(hashText('hello')).not.toBe(hashText('world'));
  });
});

describe('Y.applyUpdate convergence (sanity)', () => {
  it('two clients converge to the same state regardless of merge order', () => {
    // Client A
    const a = new Y.Doc();
    a.getText(TEXT_KEY).insert(0, 'Hello ');
    const updateA = Y.encodeStateAsUpdate(a);

    // Client B (independent)
    const b = new Y.Doc();
    b.getText(TEXT_KEY).insert(0, 'World!');
    const updateB = Y.encodeStateAsUpdate(b);

    // Merge in different orders.
    const ab = new Y.Doc();
    Y.applyUpdate(ab, updateA);
    Y.applyUpdate(ab, updateB);

    const ba = new Y.Doc();
    Y.applyUpdate(ba, updateB);
    Y.applyUpdate(ba, updateA);

    expect(ab.getText(TEXT_KEY).toString()).toBe(ba.getText(TEXT_KEY).toString());
  });
});
