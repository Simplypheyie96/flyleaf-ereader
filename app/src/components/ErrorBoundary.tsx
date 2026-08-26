import { Component } from 'react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  public render() {
    if (this.state.error) {
      return (
        <main className="page" style={{ padding: '2rem' }}>
          <h1 className="ui-h">Something went wrong</h1>
          <p className="ui-p ui-p--soft">{this.state.error.message}</p>
          <button className="btn" onClick={() => window.location.replace('/')}>Reload App</button>
        </main>
      )
    }

    return this.props.children
  }
}
