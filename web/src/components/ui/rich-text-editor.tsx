'use client';

import { useCallback, useEffect } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link2,
  Link2Off,
  Undo2,
  Redo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Basic rich text editor for the job posting long description.
 *
 * The toolbar is deliberately limited to what JobDescriptionSanitizer allows on
 * the server — no images, tables or raw HTML. Anything the toolbar cannot
 * produce would be silently stripped on save, so offering it would be a lie.
 *
 * Server-side sanitising is the real protection; this component only decides
 * what is convenient to author.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write the full job description...',
  disabled = false,
  className,
}: RichTextEditorProps) {
  const editor = useEditor({
    // Next.js renders this on the server first; without immediatelyRender:false
    // TipTap warns about a hydration mismatch.
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // Not in the server allow-list — leaving them on would let people
        // author content that vanishes when they hit save.
        codeBlock: false,
        horizontalRule: false,
        heading: { levels: [2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          // Mirrors what the server forces onto every link anyway.
          HTMLAttributes: {
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
          },
        },
      }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      // TipTap represents "empty" as <p></p>; report it as an empty string so
      // the form treats a cleared editor as no value.
      onChange(editor.isEmpty ? '' : html);
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none min-h-[160px] px-3 py-2 focus:outline-none',
          '[&_ul]:list-disc [&_ol]:list-decimal [&_ul,&_ol]:pl-5',
          '[&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold',
          '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic',
          '[&_a]:underline [&_a]:underline-offset-2'
        ),
        'data-placeholder': placeholder,
      },
    },
  });

  // Keep the editor in sync when the form resets (opening Edit on another row,
  // or reopening Create). Guarded on inequality so typing is never clobbered.
  useEffect(() => {
    if (!editor) return;
    const incoming = value || '';
    if (incoming !== editor.getHTML() && !editor.isFocused) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  }, [value, editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previous ?? 'https://');

    if (url === null) return; // cancelled

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url })
      .run();
  }, [editor]);

  if (!editor) {
    return (
      <div
        className={cn(
          'min-h-[200px] rounded-md border border-input bg-transparent',
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        'rounded-md border border-input bg-transparent focus-within:ring-1 focus-within:ring-ring',
        disabled && 'opacity-60',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border p-1">
        <ToolbarButton
          editor={editor}
          label="Bold"
          isActive={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Italic"
          isActive={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Underline"
          isActive={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Strikethrough"
          isActive={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="size-3.5" />
        </ToolbarButton>

        <Separator />

        <ToolbarButton
          editor={editor}
          label="Heading 2"
          isActive={editor.isActive('heading', { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Heading 3"
          isActive={editor.isActive('heading', { level: 3 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        >
          <Heading3 className="size-3.5" />
        </ToolbarButton>

        <Separator />

        <ToolbarButton
          editor={editor}
          label="Bullet list"
          isActive={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Numbered list"
          isActive={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Quote"
          isActive={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="size-3.5" />
        </ToolbarButton>

        <Separator />

        <ToolbarButton
          editor={editor}
          label="Add link"
          isActive={editor.isActive('link')}
          onClick={setLink}
        >
          <Link2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Remove link"
          disabled={!editor.isActive('link')}
          onClick={() => editor.chain().focus().unsetLink().run()}
        >
          <Link2Off className="size-3.5" />
        </ToolbarButton>

        <Separator />

        <ToolbarButton
          editor={editor}
          label="Undo"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          label="Redo"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 className="size-3.5" />
        </ToolbarButton>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}

function Separator() {
  return <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />;
}

interface ToolbarButtonProps {
  editor: Editor;
  label: string;
  isActive?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({
  label,
  isActive,
  disabled,
  onClick,
  children,
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={isActive}
      disabled={disabled}
      onClick={onClick}
      className={cn(isActive && 'bg-muted text-foreground')}
    >
      {children}
    </Button>
  );
}
