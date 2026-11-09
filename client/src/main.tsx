import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// шрифт лежит в сборке, а не грузится с Google Fonts: АРМ работает без интернета
import '@fontsource-variable/inter'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
