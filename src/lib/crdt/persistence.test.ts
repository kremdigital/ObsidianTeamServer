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

describe('вектор состояния не отражает удаления', () => {
  // Ради этого свойства и существует проверка по тексту в applyYjsUpdate.
  // Вектор состояния — это счётчик ВСТАВОК на клиента; удаления живут в
  // отдельном delete-set и счётчик не двигают. Раньше `changed` считался
  // только по вектору, поэтому правка-удаление не попадала ни на диск, ни к
  // другим клиентам (обнаружено 2026-08-06).
  it('удаление меняет текст, но НЕ меняет вектор состояния', () => {
    const server = new Y.Doc();
    server.getText(TEXT_KEY).insert(0, 'dx');

    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    // Клиент удаляет один символ — чистое удаление, без вставок.
    client.getText(TEXT_KEY).delete(1, 1);
    const deleteUpdate = Y.encodeStateAsUpdate(client, Y.encodeStateVector(server));

    const beforeVector = Y.encodeStateVector(server);
    const beforeText = server.getText(TEXT_KEY).toString();
    Y.applyUpdate(server, deleteUpdate);
    const afterVector = Y.encodeStateVector(server);
    const afterText = server.getText(TEXT_KEY).toString();

    expect(beforeText).toBe('dx');
    expect(afterText).toBe('d'); // текст изменился
    expect(Buffer.from(afterVector).equals(Buffer.from(beforeVector))).toBe(true); // вектор — нет
  });

  it('вставка, наоборот, меняет и текст, и вектор', () => {
    const server = new Y.Doc();
    server.getText(TEXT_KEY).insert(0, 'd');
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    client.getText(TEXT_KEY).insert(1, 'x');
    const insertUpdate = Y.encodeStateAsUpdate(client, Y.encodeStateVector(server));

    const beforeVector = Y.encodeStateVector(server);
    Y.applyUpdate(server, insertUpdate);
    expect(server.getText(TEXT_KEY).toString()).toBe('dx');
    expect(Buffer.from(Y.encodeStateVector(server)).equals(Buffer.from(beforeVector))).toBe(false);
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
