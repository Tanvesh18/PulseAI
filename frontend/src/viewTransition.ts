type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void>
  }
}

/**
 * Gives workspace-level navigation a native transition where the browser supports
 * it, while preserving the exact same synchronous update everywhere else.
 */
export function transitionWorkspace(update: () => void) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const documentWithTransition = document as TransitionDocument

  if (!reduceMotion && documentWithTransition.startViewTransition) {
    documentWithTransition.startViewTransition(update)
    return
  }

  update()
}
