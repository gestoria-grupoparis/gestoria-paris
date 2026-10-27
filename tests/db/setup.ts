import { afterAll } from 'vitest'
import { cerrarPool } from './helpers'

// Cierra el pool de cada archivo de pruebas para que la corrida termine limpia.
afterAll(cerrarPool)
