# Sistema de diseño — Gestoría Grupo Paris

Fuente de verdad visual de la app web (`web/`). Tokens en `web/src/index.css` (`@theme`), componentes en `web/src/ui/`.

## Dirección
Identidad real de Grupo Paris (brief: `.superpowers/sdd/brand-grupo-paris.md`; investigación: `.superpowers/sdd/referencias-premium.md`): **monocromo negro profundo + blanco, automotriz premium**. Referencias de nivel: Linear, Vercel, Mercury, Stripe, Porsche/Polestar digital. Pesos medios (nunca > 600), tracking negativo en tamaños grandes, capas por luminosidad (no por sombra), bordes de 1px, un solo acento funcional. El color lo ponen los estados de dinero, no la marca. Sin animaciones dentro de la app; el único movimiento es el del login (marquee + parallax), apagado con `prefers-reduced-motion`.

Se eliminó la placa verde "GP", el verde racing y el latón: eran inventados.

## Marca (`web/src/ui/marca/`)
- **Logo**: `LogoGrupoParis({ variante: 'horizontal'|'apilado', tono: 'claro'|'oscuro' })` y `Monograma` (P calada en cuadrado redondeado con corte diagonal), recreados del PNG oficial `web/public/brand/grupo-paris-logo.png`. Todo `currentColor`. Uso: login (claro, grande), sidebar (claro, h-7), header móvil (oscuro, h-7), pantalla de carga (monograma), favicon (`web/public/favicon.svg`).
- **Marcas oficiales**: `MarqueeMarcas` con las 7 marcas (Peugeot, Citroën, Chevrolet, Honda Motos, Jetour, DFSK, KYC) en `marca/marcas/*.svg` (origen y licencia en su README). Monocromo blanco al 55%.

## Color (tokens Tailwind `bg-*/text-*/ring-*`)
| Token | Claro | Uso |
|---|---|---|
| fondo | #fafafa | fondo de app |
| superficie | #ffffff | tarjetas, tablas, inputs |
| hundido / hover | #f4f4f5 / #f5f5f6 | chips neutros, segmentos, skeleton / hover de fila |
| tinta / tenue | #111113 / #5c5f66 | texto principal / secundario (AA) |
| linea / linea-fuerte | #ededef / #d4d4d8 | divisores / bordes de controles |
| **marca** | #0a0a0b | negro Grupo Paris: botón primario, KPI destacado, chip sólido |
| marca-hover / marca-suave | #27272a / #f1f1f3 | hover primario / chips "en curso" |
| noche (+ noche-2) | #0a0a0b / #141416 | sidebar, login, pantallas de carga |
| plata | #d4d4d8 | detalles sobre negro |
| **acento** | #2e6be6 (oscuro #7aa2f7) | único acento funcional: foco, selección, paso en curso. Nunca decorativo |
| disponible (+suave) | #1f7a4d (oscuro #4cc38a) | dinero disponible / pagado / estados finales OK |
| comprometido (+suave) | #8a5c00 (oscuro #e3b341) | comprometido / esperando |
| sinfondos (+suave), alerta | #c2362b (oscuro #f2766b) | deuda, sin fondos, errores, rechazado |
| info (+suave) | #2457c5 | autorizado / informativo |

Todos los textos semánticos cumplen AA (≥ 4.5:1) sobre su fondo `-suave` y sobre blanco.

**Tema oscuro** (`.tema-oscuro`): reasigna los mismos tokens (superficie #121214, tinta #f7f7f8, tenue #8a8f98, linea blanco 8%, marca blanca → botón primario blanco). Lo usan el login y las pantallas de mensaje; los componentes del kit se adaptan solos.

### Estados de trámite → tono de chip (`TONO_ESTADO`)
borrador=neutro · observado=comprometido · autorizado=info · en_gestoria=marca · presentado=marca · finalizado_registro=disponible · devuelto=disponible · cerrado=sólido (marca) · suspendido=comprometido · cancelado=apagado (tachado) · rechazado=sinfondos. El chip siempre lleva texto (nunca solo color). `ESTADOS[].chip` en `features/tramites/filtros.ts` usa los mismos tonos.

## Tipografía (Google Fonts)
- **UI**: Inter 400/500/600 (`font-sans`, `font-display` es el mismo Inter con tracking -0.02/-0.03em). Cuerpo 14px, tablas 13px.
- **Marca**: Michroma (`font-marca`), la sans extendida del logo. Solo para el wordmark, el titular del login y rótulos `.rotulo-marca` (10px, mayúsculas, +0.14em). Nunca en párrafos ni tablas.
- **Cifras**: `.cifra` (tnum + lining) en todo monto; montos a la derecha. Los montos llegan formateados: el front no calcula.
- **Rótulos**: `.rotulo` = 11px, 500, mayúsculas, tracking .06em, tenue.
- Escala: 11 · 12 · 13 · 14 · 15 · 22 · 26 · 30 · 44.

## Espacio, radios, elevación
- Escala de 4px; padding de tarjeta 20px; separación entre bloques 24px; gutter móvil 16px.
- Radios: sm 4 · md 6 (botones, inputs, chips cuadrados) · lg 10 (tarjetas, tablas) · xl 12 · 2xl 16 (hoja inferior).
- Sin sombra en tarjetas (`shadow-tarjeta` es nula): se separan con ring 1px `linea`. `shadow-flotante` solo en diálogos, paneles y popovers.
- Tablas: sin cebra, filas de 44px, divisores `linea`, header 12px/500 tenue (sin mayúsculas), hover `hover`, fila seleccionada con acento al 5% y borde izquierdo acento.

## Interacción y accesibilidad
- Objetivos táctiles ≥ 44px (Button md = 44, lg = 48; nav móvil 56).
- Foco: outline 2px `acento` con offset 2 (#7aa2f7 sobre `noche`).
- Transiciones solo de color, 150ms; skeleton con brillo. Todo se apaga con `prefers-reduced-motion`.
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
| `DataTable`, `celdaMonto`, `celdaPrincipal` | `<table>` envuelto en tarjeta: header sticky 12px/500, filas 44px, hover `hover`, `aria-selected` resaltado, `pie?`. Pasa `aria-label` igual que a una tabla |
| `LogoGrupoParis`, `Monograma` | logo oficial (`variante`, `tono`), monograma suelto (`titulo`) |
| `MarqueeMarcas`, `MARCAS_OFICIALES` | logo wall infinito del login (decorativo + lista sr-only) |
| `cx` | concatenador de clases |

## Patrones de pantalla
- **Login**: pantalla completa `noche` con `.tema-oscuro`, brillo radial sutil arriba. Logo claro arriba a la izquierda, rótulo "Gestoría interna". Columna central de 380px: rótulo Michroma "Acceso", h1 Michroma "Ingresá a tu cuenta", Email, Contraseña con Mostrar/Ocultar, error inline, botón blanco lg, nota de recuperación. Fondo: monograma gigante al 3.5% (capa de parallax lenta, máx. 8px). Pie: `MarqueeMarcas` (pista duplicada, -50% en 50s, sin costura, bordes desvanecidos, pausa en hover, estático con reduced motion) en una capa de parallax inversa (-3px). Parallax solo con transform + requestAnimationFrame, apagado con reduced motion. El paso MFA debe reutilizar este marco.
- **Shell**: sidebar `noche` 240px con logo claro, navegación con íconos (activo: blanco 8% + ring 6%), tarjeta de usuario (iniciales, nombre, rol, cerrar sesión). Móvil: header blanco con logo oscuro + avatar; bottom nav con ícono + texto, 56px, safe-area.
- **Páginas**: `PageHeader` arriba, KPIs en grilla de 2–4 (`destacado` = tarjeta negra, solo para el número principal, p.ej. "Disponible proyectado"), luego tarjetas/tabla.
- **Estados vacíos/carga/error**: siempre `EmptyState` con acción, `Cargando` con skeleton, `ErrorState` con reintento. Nunca una línea gris suelta.
- **Tabla de trámites**: columna principal en dos líneas (N° + cliente / vehículo), chip de estado, montos `celdaMonto`; filtros en barra compacta (desktop) o panel inferior (móvil, lista de tarjetas).
