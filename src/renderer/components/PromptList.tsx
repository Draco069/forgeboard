import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Prompt } from "../../shared/types";
import { Icon } from "./Icon";
import { TagFilter } from "./TagFilter";

export interface PromptListProps {
  prompts: Prompt[];
  search?: string;
  selectedPromptId?: string;
  onSelect?: (prompt: Prompt) => void;
  onSelectPrompt?: (promptId: string) => void;
  onSearchChange?: (search: string) => void;
  onToggleFavorite?: (prompt: Prompt) => void;
  onCreatePrompt?: () => void;
  selectedTags?: string[];
  onTagFilterChange?: (tags: string[]) => void;
  showFavoritesOnly?: boolean;
  onFavoritesOnlyChange?: (showFavorites: boolean) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function PromptList({
  prompts,
  search = "",
  selectedPromptId,
  onSelect,
  onSelectPrompt,
  onSearchChange,
  onToggleFavorite,
  onCreatePrompt,
  selectedTags,
  onTagFilterChange,
  showFavoritesOnly,
  onFavoritesOnlyChange,
  inputRef,
}: PromptListProps) {
  const [searchText, setSearchText] = useState(search);
  const [internalTags, setInternalTags] = useState<string[]>([]);
  const [internalFavoritesOnly, setInternalFavoritesOnly] = useState(false);
  const searchTimerRef = useRef<number | null>(null);
  const activeTags = selectedTags ?? internalTags;
  const favoritesOnly = showFavoritesOnly ?? internalFavoritesOnly;
  const availableTags = useMemo(
    () => [...new Set(prompts.flatMap((prompt) => prompt.tags))],
    [prompts],
  );

  useEffect(() => {
    setSearchText(search);
  }, [search]);

  useEffect(() => {
    if (!onSearchChange || searchText === search) {
      return undefined;
    }

    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      onSearchChange(searchText);
    }, 120);

    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    };
  }, [onSearchChange, search, searchText]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  const filteredPrompts = useMemo(() => {
    const query = normalize(searchText);
    return prompts.filter((prompt) => {
      const searchable = [prompt.title, prompt.description, prompt.body, ...prompt.tags]
        .map(normalize)
        .join(" ");
      const matchesSearch = query.length === 0 || searchable.includes(query);
      const matchesTags =
        activeTags.length === 0 ||
        activeTags.every((tag) => prompt.tags.some((promptTag) => normalize(promptTag) === normalize(tag)));
      const matchesFavorite = !favoritesOnly || prompt.favorite;
      return matchesSearch && matchesTags && matchesFavorite;
    });
  }, [activeTags, favoritesOnly, prompts, searchText]);

  const setTags = (tags: string[]): void => {
    if (selectedTags === undefined) {
      setInternalTags(tags);
    }
    onTagFilterChange?.(tags);
  };

  const setFavoritesOnly = (nextValue: boolean): void => {
    if (showFavoritesOnly === undefined) {
      setInternalFavoritesOnly(nextValue);
    }
    onFavoritesOnlyChange?.(nextValue);
  };

  return (
    <section className="prompt-list-panel" aria-labelledby="prompt-list-title">
      <div className="prompt-list-heading">
        <div>
          <p className="section-kicker">Saved prompts</p>
          <h2 id="prompt-list-title">Prompt library</h2>
        </div>
        {onCreatePrompt ? (
          <button className="button button-secondary" type="button" onClick={onCreatePrompt}>
            <Icon name="plus" size={15} />
            <span>New prompt</span>
          </button>
        ) : null}
      </div>

      <div className="prompt-search-row">
        <label className="search-field" htmlFor="prompt-search">
          <span>Search prompts</span>
          <span className="search-input-wrap">
            <Icon name="search" size={16} />
            <input
              autoComplete="off"
              id="prompt-search"
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search title, body, or tags"
              ref={inputRef}
              type="search"
              value={searchText}
            />
          </span>
        </label>
        <button
          aria-pressed={favoritesOnly}
          className={`favorites-filter ${favoritesOnly ? "is-active" : ""}`.trim()}
          type="button"
          onClick={() => setFavoritesOnly(!favoritesOnly)}
        >
          <Icon name="bookmark" size={15} />
          <span>Favorites only</span>
        </button>
      </div>

      <TagFilter
        onChange={setTags}
        selectedTags={activeTags}
        tags={availableTags}
      />

      {filteredPrompts.length > 0 ? (
        <ul className="prompt-list" aria-label="Saved prompts">
          {filteredPrompts.map((prompt) => {
            const isSelected = prompt.id === selectedPromptId;
            return (
              <li className={`prompt-list-item ${isSelected ? "is-selected" : ""}`.trim()} key={prompt.id}>
                <div className="prompt-list-item-main">
                  <button
                    aria-current={isSelected ? "true" : undefined}
                    aria-pressed={isSelected}
                    className="prompt-select"
                    type="button"
                    onClick={() => {
                      onSelect?.(prompt);
                      onSelectPrompt?.(prompt.id);
                    }}
                  >
                    <span className="prompt-select-title">{prompt.title}</span>
                    {prompt.description ? (
                      <span className="prompt-select-description">{prompt.description}</span>
                    ) : null}
                    <span className="prompt-select-meta">
                      {prompt.body ? `${prompt.body.slice(0, 92)}${prompt.body.length > 92 ? "…" : ""}` : "Empty body"}
                    </span>
                  </button>
                  {onToggleFavorite ? (
                    <button
                      aria-label={`${prompt.favorite ? "Remove" : "Add"} ${prompt.title} ${
                        prompt.favorite ? "from favorites" : "to favorites"
                      }`}
                      aria-pressed={prompt.favorite}
                      className={`favorite-button ${prompt.favorite ? "is-favorite" : ""}`.trim()}
                      title={prompt.favorite ? "Remove from favorites" : "Add to favorites"}
                      type="button"
                      onClick={() => onToggleFavorite(prompt)}
                    >
                      <Icon name="bookmark" size={16} />
                    </button>
                  ) : null}
                </div>
                {prompt.tags.length > 0 ? (
                  <ul className="prompt-tag-list" aria-label={`Tags for ${prompt.title}`}>
                    {prompt.tags.map((tag) => (
                      <li key={`${prompt.id}-${tag}`}>
                        <span className="prompt-tag">{tag}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="prompt-list-empty" role="status">
          <Icon name="search" size={20} />
          <p>{prompts.length === 0 ? "No saved prompts in this workspace yet." : "No prompts match these filters."}</p>
          {prompts.length === 0 && onCreatePrompt ? (
            <button className="button button-primary" type="button" onClick={onCreatePrompt}>
              <Icon name="plus" size={16} />
              <span>Create your first prompt</span>
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
