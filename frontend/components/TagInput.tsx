"use client";

import { useState } from "react";
import { addTags, TAG_SEPARATOR } from "@/lib/projects";
import styles from "./TagInput.module.css";

const MAX_SUGGESTIONS = 8;

/**
 * タグの入力。Enter またはカンマ(, 、 ，)で確定し、×(空欄で Backspace)で削除する。
 * 既存のタグは候補から追加できる。入力中の文字(draft)は親が持ち、保存時に取り込む。
 */
export function TagInput({
  tags,
  draft,
  suggestions,
  onChange,
  onDraftChange,
  onEscape,
}: {
  tags: string[];
  draft: string;
  suggestions: readonly string[];
  onChange: (tags: string[]) => void;
  onDraftChange: (draft: string) => void;
  onEscape?: () => void;
}) {
  const [dup, setDup] = useState<string | null>(null);

  const add = (raw: string[], nextDraft: string) => {
    const r = addTags(tags, raw);
    setDup(r.dup);
    if (r.tags.length !== tags.length) onChange(r.tags);
    onDraftChange(nextDraft);
  };

  // 候補の絞り込みは大文字小文字を区別しない(重複判定は区別する)
  const q = draft.trim().toLowerCase();
  const candidates = suggestions
    .filter(
      (s) => !tags.includes(s) && (q === "" || s.toLowerCase().includes(q)),
    )
    .slice(0, MAX_SUGGESTIONS);

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <label htmlFor="project-tags">タグ</label>
        <span id="project-tags-hint">Enter またはカンマで追加</span>
      </div>
      <div className={styles.box}>
        {tags.map((t) => (
          <span key={t} className={styles.chip}>
            <span className={styles.chipLabel}>{t}</span>
            <button
              type="button"
              className={styles.remove}
              aria-label={`タグ「${t}」を削除`}
              title={`タグ「${t}」を削除`}
              onClick={() => {
                setDup(null);
                onChange(tags.filter((x) => x !== t));
              }}
            >
              <svg
                aria-hidden="true"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </span>
        ))}
        <input
          id="project-tags"
          className={styles.input}
          aria-describedby="project-tags-hint"
          autoComplete="off"
          placeholder={tags.length > 0 ? "タグを追加" : "例: 仕事、Q4"}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (TAG_SEPARATOR.test(v)) {
              const parts = v.split(TAG_SEPARATOR);
              const rest = parts.pop() ?? "";
              add(parts, rest);
            } else {
              setDup(null);
              onDraftChange(v);
            }
          }}
          onKeyDown={(e) => {
            // 日本語入力の変換確定のキーでは何もしない
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) add([draft], "");
            } else if (e.key === "Backspace" && draft === "" && tags.length) {
              setDup(null);
              onChange(tags.slice(0, -1));
            } else if (e.key === "Escape") {
              e.preventDefault();
              onEscape?.();
            }
          }}
        />
      </div>
      {dup && (
        <div className={styles.note} role="status">
          「{dup}」はすでに追加されています
        </div>
      )}
      {candidates.length > 0 && (
        <div className={styles.suggest}>
          <span className={styles.suggestLabel}>既存のタグ</span>
          {candidates.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.suggestChip}
              aria-label={`タグ「${s}」を追加`}
              onClick={() => add([s], "")}
            >
              <svg
                aria-hidden="true"
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
