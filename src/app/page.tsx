import React from 'react'

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-white to-gray-100 dark:from-[#18181b] dark:to-[#23232a] px-4 py-12">
      <section className="w-full max-w-2xl bg-white/80 dark:bg-zinc-900/80 rounded-2xl shadow-xl p-8 flex flex-col items-center gap-8 border border-zinc-200 dark:border-zinc-800">
        <h1 className="text-4xl font-bold text-center text-zinc-900 dark:text-white tracking-tight mb-2">
          Katana APR Service
        </h1>
        <p className="text-lg text-center text-zinc-700 dark:text-zinc-300 max-w-xl">
          This is a <span className="font-semibold">Next.js</span> app that
          provides APR (Annual Percentage Rate) data for Yearn vaults and
          related DeFi protocols via API endpoints. It is designed for
          serverless deployment (e.g., Vercel).
        </p>

        <div className="w-full flex flex-col items-center gap-6">
          <h2 className="text-2xl font-semibold text-center text-zinc-800 dark:text-zinc-100">
            API Endpoints
          </h2>
          <ul className="space-y-2 text-base text-zinc-700 dark:text-zinc-300">
            <li>
              <span className="inline-block font-bold text-zinc-900 dark:text-white">
                GET{' '}
                <a
                  href="/api/vaults"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-blue-600 dark:hover:text-blue-400"
                >
                  <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
                    /api/vaults
                  </code>
                </a>
              </span>{' '}
              — Returns the latest APR data for supported vaults.
            </li>
            <li>
              <span className="inline-block font-bold text-zinc-900 dark:text-white">
                GET{' '}
                <a
                  href="/api/health"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-blue-600 dark:hover:text-blue-400"
                >
                  <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
                    /api/health
                  </code>
                </a>
              </span>{' '}
              — Health check endpoint.
            </li>
          </ul>
        </div>

        <div className="w-full flex flex-col items-center gap-2">
          <h3 className="text-xl font-semibold text-center text-zinc-800 dark:text-zinc-100 mt-4">
            Example Usage
          </h3>
          <pre className="w-full bg-zinc-100 dark:bg-zinc-800 rounded p-3 text-sm text-zinc-800 dark:text-zinc-200 overflow-x-auto">
            <code>curl https://katana-apr-service.vercel.app/api/vaults</code>
          </pre>
          <h4 className="text-lg font-medium text-center text-zinc-800 dark:text-zinc-100 mt-2">
            Example Response
          </h4>
          <pre className="w-full bg-zinc-100 dark:bg-zinc-800 rounded p-3 text-sm text-zinc-800 dark:text-zinc-200 overflow-x-auto">
            <code>{`{
  "vaults": [
    // ...vault APR data
  ]
}`}</code>
          </pre>
        </div>

        <div className="w-full flex flex-col items-center gap-2 mt-4">
          <h2 className="text-2xl font-semibold text-center text-zinc-800 dark:text-zinc-100">
            Source Code
          </h2>
          <a
            href="https://github.com/rossgalloway/katana-apr-service"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-1 px-5 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-semibold rounded-full shadow hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
          >
            View on GitHub
          </a>
        </div>
      </section>
    </main>
  )
}
