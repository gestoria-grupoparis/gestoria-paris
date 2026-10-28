import { formatearPesos } from "../../lib/dinero";
import { Button, ChipEstado, Patente, cx } from "../../ui";
import {
  IconoAlerta,
  IconoAuto,
  IconoCheck,
  IconoDoc,
  IconoFlecha,
  IconoProhibido,
} from "../../ui/Iconos";
import { etiquetaEstado } from "../tramites/filtros";
import type { Grupo, TramiteGestora } from "./consultas";

export type AccionGestora =
  "presupuesto" | "presentado" | "pago" | "finalizado" | "retirado";

const SITUACION: Record<string, { texto: string; clase: string }> = {
  pagado: { texto: "Pagado", clase: "text-disponible" },
  pagado_parcial: { texto: "Pago parcial", clase: "text-comprometido" },
  comprometido: { texto: "Presupuestado, sin pagar", clase: "text-tenue" },
};

/** Pasos que recorre la gestora con cada trámite. */
const PASOS = ["Presupuesto", "Presentado", "Finalizado", "Retirado"] as const;
const PASO_ACTUAL: Record<Grupo, number> = {
  presupuestar: 0,
  listos: 1,
  presentados: 2,
  retirar: 3,
};

function Pasos({ grupo }: { grupo: Grupo }) {
  const actual = PASO_ACTUAL[grupo];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex justify-between text-[12px] text-tenue">
        <span>
          Próximo paso:{" "}
          <strong className="font-semibold text-tinta">{PASOS[actual]}</strong>
        </span>
        <span className="cifra" aria-hidden>
          {actual + 1}/{PASOS.length}
        </span>
      </p>
      <ol className="flex items-center gap-1.5" aria-hidden>
        {PASOS.map((p, i) => (
          <li
            key={p}
            aria-hidden
            title={p}
            className={cx(
              "h-1.5 flex-1 rounded-full",
              i < actual
                ? "bg-marca"
                : i === actual
                  ? "bg-acento"
                  : "bg-hundido",
            )}
          />
        ))}
      </ol>
    </div>
  );
}

export function TarjetaTramite({
  t,
  grupo,
  ocupado,
  onAccion,
}: {
  t: TramiteGestora;
  grupo: Grupo;
  ocupado: boolean;
  onAccion: (a: AccionGestora) => void;
}) {
  const sinFondos = t.situacion === "sin_fondos";
  const pagado = t.situacion === "pagado";
  const situacion = SITUACION[t.situacion];
  const tituloId = `tarjeta-${t.id}`;
  return (
    <article
      aria-labelledby={tituloId}
      className={cx(
        "flex flex-col overflow-hidden rounded-lg bg-superficie shadow-tarjeta ring-1",
        sinFondos ? "ring-2 ring-sinfondos" : "ring-linea",
      )}
    >
      {sinFondos && (
        <div className="flex items-center gap-2.5 bg-sinfondos px-4 py-2.5 text-white">
          <IconoProhibido className="size-5" />
          <p role="alert" className="text-[14px] font-semibold tracking-tight">
            No presentar: sin fondos
          </p>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span
            className="cifra text-[12px] font-semibold tracking-wide text-tenue"
            aria-hidden="true"
          >
            {t.numero}
          </span>
          <ChipEstado estado={t.estado} etiqueta={etiquetaEstado(t.estado)} />
        </div>

        <div>
          <h3
            id={tituloId}
            className="text-[20px] leading-tight font-semibold tracking-tight"
          >
            {t.operacion.cliente_nombre}
            <span className="sr-only"> {t.numero}</span>
          </h3>
          <p className="mt-1.5 flex items-center gap-2 text-[14px] text-tinta">
            <IconoAuto className="size-[18px] text-tenue" />
            <span className="min-w-0 truncate">{t.vehiculo_desc}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-tenue">
          {t.dominio ? (
            <Patente dominio={t.dominio} />
          ) : (
            <span className="italic">Sin dominio</span>
          )}
          <span>{t.operacion.empresa.nombre}</span>
          <span aria-hidden>·</span>
          <span>Registro de {t.operacion.sucursal.provincia}</span>
        </div>

        {(t.presupuesto || situacion) && (
          <dl className="flex items-end justify-between gap-3 rounded-md bg-fondo px-3 py-2.5">
            <div>
              <dt className="rotulo">Presupuesto</dt>
              <dd
                data-testid="presupuesto"
                className="cifra mt-0.5 whitespace-nowrap font-display text-[19px] font-semibold tracking-[-0.02em]"
              >
                {t.presupuesto ? formatearPesos(t.presupuesto) : "—"}
              </dd>
            </div>
            {situacion && (
              <div className="text-right">
                <dt className="sr-only">Pago</dt>
                <dd
                  className={cx(
                    "flex items-center gap-1 text-[13px] font-semibold",
                    situacion.clase,
                  )}
                >
                  {pagado && <IconoCheck className="size-4" />}
                  <span data-testid="situacion">{situacion.texto}</span>
                </dd>
              </div>
            )}
          </dl>
        )}

        <Pasos grupo={grupo} />
      </div>

      <div className="grid gap-2 border-t border-linea bg-fondo/50 px-4 py-3">
        {grupo === "presupuestar" && (
          <Button
            tamano="lg"
            ancho
            icono={<IconoDoc />}
            disabled={ocupado}
            onClick={() => onAccion("presupuesto")}
          >
            Cargar presupuesto
          </Button>
        )}
        {grupo === "listos" && (
          <Button
            tamano="lg"
            ancho
            icono={sinFondos ? <IconoAlerta /> : <IconoFlecha />}
            disabled={ocupado || sinFondos}
            onClick={() => onAccion("presentado")}
          >
            Marcar presentado
          </Button>
        )}
        {grupo !== "presupuestar" && !pagado && (
          <Button
            tamano="lg"
            ancho
            variante={grupo === "presentados" ? "primario" : "secundario"}
            disabled={ocupado}
            onClick={() => onAccion("pago")}
          >
            Registrar pago
          </Button>
        )}
        {grupo === "presentados" && (
          <Button
            tamano="lg"
            ancho
            variante="secundario"
            disabled={ocupado}
            onClick={() => onAccion("finalizado")}
          >
            Marcar finalizado
          </Button>
        )}
        {grupo === "retirar" && (
          <Button
            tamano="lg"
            ancho
            icono={<IconoCheck />}
            disabled={ocupado}
            onClick={() => onAccion("retirado")}
          >
            Marcar retirado
          </Button>
        )}
      </div>
    </article>
  );
}
