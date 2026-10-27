import { useRef, useState } from 'preact/hooks';

interface FileDropProps {
  /** Accepted formats and the privacy note, under the title. */
  formats: string;
  onFiles: (files: FileList | null) => void;
  disabled?: boolean;
  /**
   * Once files are loaded: a one-line "Add more files" bar below them instead of the large
   * drop zone, so the loaded data come first.
   */
  compact?: boolean;
}

/** A drop zone with a file picker, for several files at once. */
export function FileDrop({ formats, onFiles, disabled = false, compact = false }: FileDropProps) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      class={`drop-zone${compact ? ' is-compact' : ''}${dragging ? ' is-dragging' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) onFiles(e.dataTransfer?.files ?? null);
      }}
    >
      {compact ? (
        <p class="drop-zone-line">
          <strong>Add more files</strong> by dropping them here, or
        </p>
      ) : (
        <>
          <p class="drop-zone-title">Drag and drop files here</p>
          <p class="field-hint">{formats}</p>
        </>
      )}
      <button
        type="button"
        class={compact ? 'btn' : 'btn btn-primary'}
        onClick={() => input.current?.click()}
        disabled={disabled}
      >
        Choose files
      </button>
      <input
        ref={input}
        type="file"
        multiple
        class="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          onFiles(e.currentTarget.files);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}
