# Sistema de diseño — Gestoría Grupo Paris

Fuente de verdad visual de la app web (`web/`). Tokens en `web/src/index.css` (`@theme`), componentes en `web/src/ui/`.

## Dirección
Herramienta interna de oficina: seria, cálida y legible, nunca "planilla". Referencia de nivel (no de marca): tipografía editorial grande, fondos crema, un único color de marca profundo, badge pequeño junto al wordmark, mucho aire, sin animación gratuita (motion 2/10, densidad 6/10).

Nota: la búsqueda `--design-system` de ui-ux-pro-max propuso "Motion-Driven" + Syncopate/Space Mono + slate/rojo. Se descartó: contradice "sin animaciones", y una tipografía ancha y monoespaciada cansa en tablas de uso diario. Se tomó de ahí solo la densidad estándar y el motion sutil.

## Marca
- **Wordmark**: "Gestoría" (Bricolage Grotesque 800) sobre "GRUPO PARIS" (versalitas espaciadas, 10px, tracking .18em).
- **Badge "Placa"**: rectángulo verde con franja superior de latón y "GP": evoca una patente (el negocio son autos). Se usa en login, sidebar, header móvil y favicon (`web/public/favicon.svg`).

## Color (tokens Tailwind `bg-*/text-*/ring-*`)
| Token | Hex | Uso |
|---|---|---|
| fondo | #f5f2eb | fondo de app (crema cálido) |
| superficie | #fffdf8 | tarjetas, tablas, inputs |
| hundido | #ece7dc | header de tabla, chips neutros, skeleton |
| tinta / tenue | #1c1a16 / #5e574b | texto principal / secundario (AA sobre fondo y superficie) |
| linea / linea-fuerte | #e2dccf / #c9c0ae | divisores / bordes de controles |
| **marca** | #0f4a37 | verde Paris (racing green): botón primario, activo, KPI destacado |
| marca-suave / marca-tinta | #e3eee8 / #0a2e22 | hover de fila, chips "en curso" |
| noche | #0c1f18 | sidebar y panel del login |
| laton | #c79a3b | acento único: franja de la placa, indicador de navegación activa, rótulos sobre oscuro. Nunca para texto sobre claro |
| disponible (+suave) | #17663f | dinero disponible / estados finales OK |
| comprometido (+suave) | #8a5a00 | dinero comprometido / esperando (observado, suspendido) |
| sinfondos (+suave), alerta | #a8261b | sin fondos, errores, rechazado |
| info (+suave) | #1f4f86 | autorizado / informativo |

### Estados de trámite → tono de chip (`TONO_ESTADO`)
borrador=neutro · observado=comprometido · autorizado=info · en_gestoria=marca · presentado=marca · finalizado_registro=disponible · devuelto=disponible · cerrado=sólido (marca) · suspendido=comprometido · cancelado=apagado (tachado) · rechazado=sinfondos. El chip siempre lleva texto (nunca solo color). `ESTADOS[].chip` en `features/tramites/filtros.ts` usa los mismos tonos.

## Tipografía (Google Fonts)
- **Display**: Bricolage Grotesque 500/700/800 — `h1–h3`, KPIs, wordmark. `font-display`.
- **Texto**: Public Sans 400–700 — cuerpo 15px / 1.5. Tiene cifras tabulares reales.
- **Cifras**: clase `.cifra` (tnum + lining) en todo monto; montos alineados a la derecha. JetBrains Mono solo para códigos (N° de trámite, dominio) si hace falta.
- **Rótulos**: `.rotulo` = 11px, 600, mayúsculas, tracking .08em, color tenue.
- Escala: 11 · 13 · 15 · 18 · 28 · 34 · 52 (login).

## Espacio, radios, elevación
- Escala de 4px; padding de tarjeta 20px; separación entre bloques 24px; gutter móvil 16px.
- Radios: sm 6 · md 10 (botones, inputs) · lg 16 (tarjetas, tablas) · xl 24 (login).
- Sombras: `shadow-tarjeta` (apenas perceptible) y `shadow-flotante` (diálogos, paneles). Las tarjetas se separan con ring 1px `linea` + sombra suave, no con bordes duros.

## Interacción y accesibilidad
- Objetivos táctiles ≥ 44px (Button md = 44, lg = 48; nav móvil 56).
- Foco: outline 2px marca con offset 2 (latón sobre fondo `noche`).
- Transiciones solo de color, 150ms; skeleton con brillo que se apaga con `prefers-reduced-motion`.
- Mantener roles y nombres accesibles: los tests E2E dependen de ellos.

## Kit de componentes (`import { … } from '../ui'`)
| Componente | API |
|---|---|
| `Button` | `variante: 'primario'\|'secundario'\|'fantasma'\|'peligro'`, `tamano: 'sm'\|'md'\|'lg'`, `icono?`, `cargando?` (spinner + disabled + aria-busy), `ancho?`; `type` por defecto `button` |
| `Field` | `label`, `id?`, `ayuda?`, `error?`, `extra?` (p.ej. "Mostrar"); hijo render-prop recibe `{id, aria-describedby, aria-invalid}` |
| `Input`, `claseControl` | input 44px con estados hover/focus/invalid; `claseControl` para `select`/`textarea` |
| `Chip`, `ChipEstado`, `TONO_ESTADO` | `tono: neutro\|marca\|info\|disponible\|comprometido\|sinfondos\|apagado\|solido`, `punto?`; `ChipEstado({estado, etiqueta})` |
| `Card`, `CardHeader` | `Card plana?` + atributos de div; `CardHeader({titulo, rotulo?, acciones?})` |
| `KpiTile` | `rotulo`, `valor` (YA formateado con `formatearPesos`, el front no calcula), `detalle?`, `tono: neutro\|destacado\|disponible\|comprometido\|sinfondos`, `icono?` |
| `EmptyState` | `titulo`, `descripcion?`, `accion?`, `icono?` |
| `ErrorState` | `titulo?`, `descripcion?`, `accion?` (role=alert) |
| `Skeleton`, `Cargando` | `Cargando({filas?, etiqueta?})` = role=status + filas skeleton |
| `PageHeader` | `titulo` (h1), `rotulo?`, `descripcion?`, `acciones?` |
| `DataTable`, `celdaMonto`, `celdaPrincipal` | `<table>` envuelto en tarjeta: header sticky en versalitas, filas 48px, hover marca-suave, `aria-selected` resaltado, `pie?`. Pasa `aria-label` igual que a una tabla |
| `Wordmark`, `Placa` | `Wordmark({tono: 'oscuro'\|'claro'})` |
| `cx` | concatenador de clases |

## Patrones de pantalla
- **Login**: split. Izquierda (≥lg) panel `noche` con wordmark claro, titular de 52px en tres líneas con remate en latón y una línea de propósito; derecha formulario sobre crema: h1 "Ingresá a tu cuenta", ayuda, Email, Contraseña con "Mostrar/Ocultar", error inline en caja `sinfondos-suave`, botón lg ancho, nota de recuperación (gerencia). En móvil: tarjeta crema sobre fondo noche. El paso MFA debe reutilizar este mismo marco.
- **Shell**: sidebar `noche` 240px con wordmark, navegación con íconos (activo: fondo translúcido + barra de latón), tarjeta de usuario (iniciales, nombre, rol, cerrar sesión). Móvil: header con wordmark + avatar; bottom nav con ícono + texto, 56px, safe-area.
- **Páginas**: `PageHeader` arriba, KPIs en grilla de 2–4 (`destacado` solo para el número principal, p.ej. "Disponible proyectado"), luego tarjetas/tabla.
- **Estados vacíos/carga/error**: siempre `EmptyState` con acción, `Cargando` con skeleton, `ErrorState` con reintento. Nunca una línea gris suelta.
- **Tabla de trámites**: columna principal en dos líneas (N° + cliente / vehículo), chip de estado, montos `celdaMonto`; filtros en barra compacta (desktop) o panel inferior (móvil, lista de tarjetas).
