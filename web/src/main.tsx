import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AVISO_SESION_VENCIDA, crearQueryClient } from './lib/consultas'
import { supabase } from './lib/supabase'
import { ProveedorSesion } from './lib/sesion'
import { Rutas } from './app/rutas'
import { LimiteError } from './ui'
import './index.css'

const queryClient = crearQueryClient(() => {
  try {
    sessionStorage.setItem(AVISO_SESION_VENCIDA, '1')
  } catch {
    /* sin storage */
  }
  void supabase.auth.signOut()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ProveedorSesion>
          <LimiteError>
            <Rutas />
          </LimiteError>
        </ProveedorSesion>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
