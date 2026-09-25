import { useState } from "react";

export interface TagFilterProps {
  tags: string[];
  selectedTags?: string[];
  selectedTag?: string;
  onChange?: (tags: string[]) => void;
  onSelect?: (tag: string | null) => void;
}

export function TagFilter({
  tags,
  selectedTags,
  selectedTag,
  onChange,
  onSelect,
}: TagFilterProps) {
  const [internalTags, setInternalTags] = useState<string[]>(selectedTags ?? []);
  const activeTags = selectedTags ?? (selectedTag ? [selectedTag] : internalTags);
  const uniqueTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

  const setTags = (nextTags: string[]): void => {
    if (selectedTags === undefined) {
      setInternalTags(nextTags);
    }
    onChange?.(nextTags);
  };

  const toggleTag = (tag: string): void => {
    const isSelected = activeTags.includes(tag);
    const nextTags = isSelected
      ? activeTags.filter((activeTag) => activeTag !== tag)
      : [...activeTags, tag];
    setTags(nextTags);
    onSelect?.(isSelected ? null : tag);
  };

  return (
    <fieldset className="tag-filter">
      <legend>Filter by tag</legend>
      <div className="tag-filter-options">
        <button
          aria-pressed={activeTags.length === 0}
          className={`tag-chip ${activeTags.length === 0 ? "is-active" : ""}`.trim()}
          type="button"
          onClick={() => {
            setTags([]);
            onSelect?.(null);
          }}
        >
          All tags
        </button>
        {uniqueTags.map((tag) => {
          const isActive = activeTags.includes(tag);
          return (
            <button
              aria-label={`Filter by ${tag}`}
              aria-pressed={isActive}
              className={`tag-chip ${isActive ? "is-active" : ""}`.trim()}
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          );
        })}
      </div>
      {uniqueTags.length === 0 ? <p className="field-hint">Tags will appear here as prompts are saved.</p> : null}
    </fieldset>
  );
}
