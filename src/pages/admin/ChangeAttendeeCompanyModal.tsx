// Cambia la empresa (companyId) de un asistente a otra empresa ya existente del
// evento. Actualiza los datos de empresa del asistente y, opcionalmente, mueve
// sus productos. Las reuniones NO se tocan: los participantes se guardan por
// uid, así que siguen siendo de la persona (con su hora y mesa).

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Stack,
  Text,
  Select,
  Checkbox,
  Group,
  Button,
  Alert,
  Loader,
  List,
} from "@mantine/core";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { collection, doc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "../../firebase/firebaseConfig";

interface Props {
  opened: boolean;
  onClose: () => void;
  eventId: string;
  /** Asistente (users/{id}) */
  attendee: any | null;
  /** Se llama tras guardar, para refrescar listas */
  onChanged?: (msg: string) => void;
}

interface Impact {
  accepted: number;
  pendingToOldCompany: number;
  productIds: string[];
  /** Otros asistentes que quedan en la empresa anterior */
  remainingInOldCompany: number;
}

const companyName = (c: any) => String(c?.razonSocial || c?.company_razonSocial || c?.nitNorm || c?.id || "");

export default function ChangeAttendeeCompanyModal({ opened, onClose, eventId, attendee, onChanged }: Props) {
  const [companies, setCompanies] = useState<any[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [moveProducts, setMoveProducts] = useState(true);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const oldCompanyId: string = attendee?.companyId || "";

  // Cargar empresas del evento + impacto del cambio al abrir
  useEffect(() => {
    if (!opened || !attendee?.id || !eventId) return;
    setTargetId(null);
    setMoveProducts(true);
    setError("");
    setImpact(null);
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [companiesSnap, meetingsSnap, productsSnap, colleaguesSnap] = await Promise.all([
          getDocs(collection(db, "events", eventId, "companies")),
          getDocs(
            query(
              collection(db, "events", eventId, "meetings"),
              where("participants", "array-contains", attendee.id),
            ),
          ),
          getDocs(
            query(collection(db, "events", eventId, "products"), where("ownerUserId", "==", attendee.id)),
          ),
          oldCompanyId
            ? getDocs(
                query(
                  collection(db, "users"),
                  where("eventId", "==", eventId),
                  where("companyId", "==", oldCompanyId),
                ),
              )
            : Promise.resolve(null),
        ]);
        if (cancelled) return;

        setCompanies(
          companiesSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => companyName(a).localeCompare(companyName(b), "es")),
        );

        const meetings = meetingsSnap.docs.map((d) => d.data() as any);
        // Pendientes dirigidas a la empresa anterior (las podrá atender un compañero; él ya no)
        const pendingCompanyMeetingsSnap = oldCompanyId
          ? await getDocs(
              query(
                collection(db, "events", eventId, "meetings"),
                where("companyId", "==", oldCompanyId),
                where("status", "==", "pending"),
              ),
            )
          : null;
        if (cancelled) return;

        setImpact({
          accepted: meetings.filter((m) => m.status === "accepted" || m.status === "standby").length,
          pendingToOldCompany: pendingCompanyMeetingsSnap
            ? pendingCompanyMeetingsSnap.docs.filter((d) => !(d.data() as any).receiverId).length
            : 0,
          productIds: productsSnap.docs
            .filter((d) => !oldCompanyId || (d.data() as any).companyId === oldCompanyId || !(d.data() as any).companyId)
            .map((d) => d.id),
          remainingInOldCompany: colleaguesSnap
            ? colleaguesSnap.docs.filter((d) => d.id !== attendee.id).length
            : 0,
        });
      } catch (e) {
        console.error("Error cargando datos para cambiar empresa:", e);
        if (!cancelled) setError("No se pudo cargar la información. Cierra e intenta de nuevo.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, attendee?.id, eventId, oldCompanyId]);

  const options = useMemo(
    () =>
      companies
        .filter((c) => c.id !== oldCompanyId)
        .map((c) => ({ value: c.id, label: `${companyName(c)} · ${c.id}` })),
    [companies, oldCompanyId],
  );
  const oldCompany = companies.find((c) => c.id === oldCompanyId);
  const target = companies.find((c) => c.id === targetId);

  const handleSave = async () => {
    if (!attendee?.id || !target) return;
    setSaving(true);
    setError("");
    try {
      const razon = String(target.razonSocial || target.company_razonSocial || "").trim();
      const batch = writeBatch(db);

      const userUpdate: Record<string, any> = {
        companyId: target.id,
        company_razonSocial: razon || null,
        empresa: razon || target.id,
        // La mesa fija se hereda de la empresa (igual que al asignarla desde el admin)
        fixedTable: target.fixedTable ?? null,
        updatedAt: new Date().toISOString(),
      };
      // Asistentes antiguos guardaban también company_nit
      if (attendee.company_nit !== undefined) userUpdate.company_nit = target.id;
      batch.update(doc(db, "users", attendee.id), userUpdate);

      if (moveProducts && impact?.productIds.length) {
        impact.productIds.forEach((pid) => {
          batch.update(doc(db, "events", eventId, "products", pid), {
            companyId: target.id,
            ownerCompany: razon || target.id,
            updatedAt: new Date(),
          });
        });
      }

      await batch.commit();
      onChanged?.(
        `${attendee.nombre || "El asistente"} ahora pertenece a ${razon || target.id}.`,
      );
      onClose();
    } catch (e) {
      console.error("Error cambiando la empresa del asistente:", e);
      setError("No se pudo cambiar la empresa. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Cambiar empresa del asistente" centered size="lg">
      <Stack gap="md">
        <Text size="sm">
          <b>{attendee?.nombre || "Asistente"}</b> · empresa actual:{" "}
          <b>{oldCompany ? companyName(oldCompany) : attendee?.empresa || "sin empresa"}</b>
          {oldCompanyId ? ` (${oldCompanyId})` : ""}
        </Text>

        {loading ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : (
          <>
            <Select
              label="Nueva empresa"
              placeholder="Busca por nombre o NIT"
              data={options}
              value={targetId}
              onChange={setTargetId}
              searchable
              nothingFoundMessage="No hay empresas con ese nombre o NIT"
              comboboxProps={{ withinPortal: true }}
            />

            {impact && (
              <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />} title="Qué pasa al cambiarlo">
                <List size="sm" spacing={4}>
                  <List.Item>
                    {impact.accepted > 0
                      ? `Sus ${impact.accepted} reunión(es) confirmada(s) se mantienen con él (misma hora y mesa).`
                      : "No tiene reuniones confirmadas."}
                  </List.Item>
                  {impact.pendingToOldCompany > 0 && (
                    <List.Item>
                      Hay {impact.pendingToOldCompany} solicitud(es) pendiente(s) dirigida(s) a la empresa anterior:
                      ya no las verá; las atienden sus compañeros.
                    </List.Item>
                  )}
                  {target && (target.fixedTable ?? null) !== (attendee?.fixedTable ?? null) && (
                    <List.Item>
                      Sus nuevas reuniones usarán la mesa de la nueva empresa
                      {target.fixedTable ? ` (${target.fixedTable})` : " (sin mesa fija)"}.
                    </List.Item>
                  )}
                </List>
              </Alert>
            )}

            {impact && impact.productIds.length > 0 && (
              <Checkbox
                checked={moveProducts}
                onChange={(e) => setMoveProducts(e.currentTarget.checked)}
                label={`Mover también sus ${impact.productIds.length} producto(s) a la nueva empresa`}
              />
            )}

            {impact && oldCompanyId && impact.remainingInOldCompany === 0 && (
              <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />}>
                Es el único representante de la empresa anterior: quedará sin representantes.
              </Alert>
            )}
          </>
        )}

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!target || loading}>
            Cambiar empresa
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
