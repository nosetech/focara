import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveNavShortcut,
  shortcutKeyFor,
  type ShortcutEvent,
} from "./shortcuts.ts";

const ev = (key: string, o: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  targetInInput: false,
  ...o,
});

test("r/i/a は大文字小文字を問わず移動先に対応する", () => {
  assert.equal(resolveNavShortcut(ev("r"), "/organize/inbox", false), "/");
  assert.equal(resolveNavShortcut(ev("R"), "/organize/inbox", false), "/");
  assert.equal(resolveNavShortcut(ev("i"), "/", false), "/organize/inbox");
  assert.equal(resolveNavShortcut(ev("I"), "/", false), "/organize/inbox");
  assert.equal(resolveNavShortcut(ev("a"), "/", false), "/organize/assign");
  assert.equal(resolveNavShortcut(ev("A"), "/", false), "/organize/assign");
});

test("修飾キー・IME・入力欄・ダイアログ中は無視する", () => {
  assert.equal(
    resolveNavShortcut(ev("r", { ctrlKey: true }), "/x", false),
    null,
  );
  assert.equal(
    resolveNavShortcut(ev("r", { metaKey: true }), "/x", false),
    null,
  );
  assert.equal(
    resolveNavShortcut(ev("r", { altKey: true }), "/x", false),
    null,
  );
  assert.equal(
    resolveNavShortcut(ev("r", { isComposing: true }), "/x", false),
    null,
  );
  assert.equal(
    resolveNavShortcut(ev("r", { targetInInput: true }), "/x", false),
    null,
  );
  assert.equal(resolveNavShortcut(ev("r"), "/x", true), null);
});

test("現在地と同じ移動先・対象外のキー(N など)は無視する", () => {
  assert.equal(resolveNavShortcut(ev("i"), "/organize/inbox", false), null);
  assert.equal(resolveNavShortcut(ev("n"), "/", false), null);
  assert.equal(resolveNavShortcut(ev("j"), "/", false), null);
});

test("shortcutKeyFor は対象画面だけキーを返す", () => {
  assert.equal(shortcutKeyFor("/"), "R");
  assert.equal(shortcutKeyFor("/organize/inbox"), "I");
  assert.equal(shortcutKeyFor("/organize/assign"), "A");
  assert.equal(shortcutKeyFor("/organize"), undefined);
  assert.equal(shortcutKeyFor("/organize/day"), undefined);
});
