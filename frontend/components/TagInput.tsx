"use client";

import { useState } from "react";
import { normalizeTags } from "@/lib/projects";
import styles from "./TagInput.module.css";

/** タグの入力。Enter またはカンマで確定し、×(空欄で Backspace)で削除する。既存のタグは候補から追加できる。 */
const MAX_SUGGESTIONS = 8;

export function TagInput({
  tags,
  suggestions,
  onChange,
}: {
  tags: string[];
  suggestions: readonly string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [dup, setDup] = useState<string | null>(null);

  const add = (raw: string) => {
    const incoming = normalizeTags(raw.split(/[,、]/));
    const fresh = incoming.filter((t) => !tags.includes(t));
    setDup(incoming.find((t) => tags.includes(t)) ?? null);
    if (fresh.length > 0) onChange([...tags, ...fresh]);
    setDraft("");
  };

  const candidates = suggestions
    .filter((s) => !tags.includes(s) && s.includes(draft.trim()))
    .slice(0, MAX_SUGGESTIONS);

  return (
    <div>
      <div className={styles.head}>
        <label htmlFor="project-tags">タグ</label>
        <span>Enter またはカンマで追加</span>
      </div>
      <div className={styles.box}>
        {tags.map((t) => (
          <span key={t} className={styles.chip}>
            {t}
            <button
              type="button"
              className={styles.remove}
              aria-label={`タグ「${t}」を削除`}
              onClick={() => onChange(tags.filter((x) => x !== t))}
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
          placeholder={tags.length === 0 ? "例: 仕事、Q4" : ""}
          value={draft}
          onChange={(e) => {
            setDup(null);
            const v = e.target.value;
            if (/[,、]/.test(v)) add(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            // 日本語入力の変換確定の Enter では追加しない
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (draft.trim()) add(draft);
            } else if (e.key === "Backspace" && draft === "" && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
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
              onClick={() => add(s)}
            >
              <svg
                aria-hidden="true"
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
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
