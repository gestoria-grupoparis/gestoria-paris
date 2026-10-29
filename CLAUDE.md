## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## Reglas de trabajo del dueño

- Usar siempre las herramientas disponibles con criterio: antes de cada tarea revisar los conectores, MCP y skills que apliquen (graphify para ubicar código, Supabase MCP para la base, navegador para verificar, Cloudflare para el despliegue, skills de diseño para UI, superpowers para planificar/ejecutar). No lanzar herramientas que no correspondan (p. ej. REA solo para analizar sitios o binarios).
- Si una tarea necesita una skill o MCP que no está instalado, buscarlo e instalarlo (sin servicios pagos ni credenciales del usuario).
- Terminar cada mensaje indicando la mejor skill para el próximo paso.
- Rendiciones y presupuestador de costos son módulos internos: solo gerencia y contable; la gestora no los ve.
- Textos en español (Argentina); el usuario no es técnico.
