import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './tuples/index'
import App from './App'
import { BASE } from './base'
import { ExpsPage } from './exps/ExpsPage'
import { RunningPage } from './running/RunningPage'

// sub-pages: <base>/exps is the experiment board, <base>/running the comparison, everything else is the file browser
const sub = window.location.pathname.replace(BASE, '').replace(/\/$/, '')
const Page = sub === '/exps' ? ExpsPage : sub === '/running' ? RunningPage : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
