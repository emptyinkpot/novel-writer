'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

export default function Editor() {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: '开始写作...',
      }),
    ],
    editorProps: {
      attributes: {
        class:
          'prose prose-lg max-w-none font-serif min-h-full px-12 py-8 focus:outline-none',
      },
    },
  })

  return (
    <div className="h-full">
      <EditorContent editor={editor} className="h-full" />
    </div>
  )
}
