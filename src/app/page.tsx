import fs from 'fs'
import path from 'path'
import ReactMarkdown from 'react-markdown'

import React from 'react'

export default function Home(): React.JSX.Element {
  let readme = ''
  try {
    readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8')
  } catch {
    readme = 'README.md not found.'
  }

  return (
    <div className="prose mx-auto p-8">
      <article>
        <ReactMarkdown>{readme}</ReactMarkdown>
      </article>
    </div>
  )
}
