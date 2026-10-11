import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Workflow, Plus, Power, Trash2, MessageSquareText, Clock3, Handshake, UsersRound } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/automacoes")({
  head: () => ({ meta: [{ title: "Automações — Wapnus" }] }),
  component: AutomationsPage,
});

type TriggerType = "keyword_match" | "conversation_created" | "outside_business_hours" | "auto_assignment" | "auto_crm_lead";
type AutomationStep = { id: string; kind: "text" | "image" | "audio"; content: string; file: File | null; durationMs?: number; previewUrl?: string };
type StoredAutomationStep = { id: string; kind: "text" | "image" | "audio"; text?: string; caption?: string; storagePath?: string; mimeType?: string; fileName?: string; durationMs?: number };
type Rule = {
  id: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
  description: string | null;
  config: { keyword?: string; reply?: string; startTime?: string; endTime?: string; days?: number[]; actionType?: string; steps?: StoredAutomationStep[] } | null;
};

const triggerLabels: Record<TriggerType, string> = {
  keyword_match: "Palavra-chave",
  conversation_created: "Boas-vindas (primeira mensagem)",
  outside_business_hours: "Fora do horário de atendimento",
  auto_assignment: "Distribuição automática",
  auto_crm_lead: "Criar oportunidade no CRM",
};

function triggerDescription(rule: Rule) {
  if (rule.config?.actionType === "assign_agent") return "Atribui a conversa ao membro elegível com menos conversas activas; a IA continua activa até alguém assumir o atendimento.";
  if (rule.config?.actionType === "create_deal") return "Cria uma oportunidade na etapa inicial quando chega a primeira mensagem, sem duplicar oportunidades abertas do mesmo contacto.";
  if (rule.trigger_type === "keyword_match") return `Quando a mensagem contém “${rule.config?.keyword ?? "palavra-chave"}”`;
  if (rule.trigger_type === "outside_business_hours") return `Quando a mensagem chega fora de ${rule.config?.startTime ?? "09:00"}–${rule.config?.endTime ?? "18:00"}`;
  if (rule.trigger_type === "conversation_created") return "Na primeira mensagem de uma nova conversa";
  return "Este tipo de regra ainda não é suportado pelo motor atual.";
}

function AutomationsPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const canManage = membership?.role === "OWNER" || membership?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("keyword_match");
  const [keyword, setKeyword] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [steps, setSteps] = useState<AutomationStep[]>([{ id: "step-initial", kind: "text", content: "", file: null }]);
  const [draggingStepId, setDraggingStepId] = useState<string | null>(null);
  const [recordingStepId, setRecordingStepId] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartedAtRef = useRef<number>(0);
  const recordingChunksRef = useRef<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["automations", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("automation_rules")
        .select("id, name, trigger_type, is_active, description, config")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (err) throw new Error(err.message);
      return (data ?? []) as Rule[];
    },
  });

  const createRule = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Não foi encontrada uma organização activa.");
      const cleanName = name.trim();
      const cleanKeyword = keyword.trim();
      if (cleanName.length < 2) throw new Error("Dê um nome à automação.");
      if (triggerType === "keyword_match" && cleanKeyword.length < 2) throw new Error("A palavra-chave deve ter pelo menos 2 caracteres.");
      if (triggerType === "outside_business_hours" && startTime === endTime) throw new Error("A hora inicial e final não podem ser iguais.");
      const usesActions = triggerType !== "auto_assignment" && triggerType !== "auto_crm_lead";
      const usableSteps = usesActions ? steps.filter((step) => step.kind === "text" ? step.content.trim().length > 0 : Boolean(step.file)) : [];
      if (usesActions && usableSteps.length === 0) throw new Error("Adicione pelo menos uma etapa de texto, imagem ou áudio.");
      if (usesActions && steps.some((step) => step.kind !== "text" && !step.file)) {
        throw new Error("Escolha um ficheiro para cada etapa de imagem ou áudio.");
      }

      const uploadedPaths: string[] = [];
      let storedSteps: StoredAutomationStep[] = [];
      try {
        for (const step of usableSteps) {
          if (step.kind === "text") {
            storedSteps.push({ id: step.id, kind: "text", text: step.content.trim() });
            continue;
          }
          const file = step.file;
          if (!file) throw new Error("Escolha um ficheiro para cada etapa de mídia.");
          const allowedMime = step.kind === "image" ? file.type.startsWith("image/") : file.type.startsWith("audio/");
          if (!allowedMime) throw new Error(step.kind === "image" ? "Escolha um ficheiro de imagem válido." : "Escolha um ficheiro de áudio válido.");
          if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error("Cada ficheiro deve ter até 20 MB.");
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || (step.kind === "image" ? "imagem" : "audio");
          const storagePath = `${orgId}/${crypto.randomUUID()}-${safeName}`;
          const { error: uploadError } = await supabase.storage.from("automation-media")
            .upload(storagePath, file, { contentType: file.type, upsert: false });
          if (uploadError) throw new Error("Falha ao carregar mídia: " + uploadError.message);
          uploadedPaths.push(storagePath);
          storedSteps.push({
            id: step.id,
            kind: step.kind,
            storagePath,
            mimeType: file.type,
            fileName: file.name,\n            ...(step.kind === "audio" && step.durationMs ? { durationMs: step.durationMs } : {}),
            ...(step.kind === "image" && step.content.trim() ? { caption: step.content.trim() } : {}),
          });
        }

        const cleanReply = storedSteps.filter((step) => step.kind === "text").map((step) => step.text ?? "").join("\\n").trim();
        const baseConfig: Record<string, unknown> = triggerType === "keyword_match"
          ? { keyword: cleanKeyword, reply: cleanReply, steps: storedSteps }
          : triggerType === "outside_business_hours"
            ? { reply: cleanReply, steps: storedSteps, startTime, endTime, days: [1, 2, 3, 4, 5] }
            : { reply: cleanReply, steps: storedSteps };
        const config = triggerType === "auto_assignment"
          ? { actionType: "assign_agent" }
          : triggerType === "auto_crm_lead"
            ? { actionType: "create_deal" }
            : baseConfig;
      const storedTriggerType = triggerType === "auto_assignment" || triggerType === "auto_crm_lead" ? "conversation_created" : triggerType;

      const description = triggerType === "auto_assignment"
        ? "Distribui novas conversas pelo agente elegível com menor carga"
        : triggerType === "auto_crm_lead"
          ? "Cria uma oportunidade CRM na primeira mensagem de uma conversa"
          : triggerType === "keyword_match"
          ? `Responde quando a mensagem contém: ${cleanKeyword}`
          : triggerType === "outside_business_hours"
            ? `Responde fora do horário ${startTime}–${endTime}, de segunda a sexta`
            : "Envia uma saudação na primeira mensagem de uma conversa";

      const { error: err } = await supabase.from("automation_rules").insert({
        organization_id: orgId,
        name: cleanName,
        description,
        trigger_type: storedTriggerType,
        conditions: [],
        config,
        is_active: true,
      });
      if (err) throw new Error(err.message);
      } catch (error) {
        if (uploadedPaths.length) await supabase.storage.from("automation-media").remove(uploadedPaths);
        throw error;
      }
    },
    onSuccess: () => {
      setName(""); setKeyword(""); setSteps([{ id: crypto.randomUUID(), kind: "text", content: "", file: null }]); setError(null);
      setNotice("Automação criada. Teste primeiro com uma conversa controlada.");
      void queryClient.invalidateQueries({ queryKey: ["automations", orgId] });
    },
    onError: (e: Error) => { setError(e.message); setNotice(null); },
  });

  const toggleRule = useMutation({
    mutationFn: async (rule: Rule) => {
      const { error: err } = await supabase.from("automation_rules")
        .update({ is_active: !rule.is_active, updated_at: new Date().toISOString() })
        .eq("id", rule.id).eq("organization_id", orgId!);
      if (err) throw new Error(err.message);
    },
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ["automations", orgId] }); },
    onError: (e: Error) => setError(e.message),
  });

  const deleteRule = useMutation({
    mutationFn: async (rule: Rule) => {
      const { error: actionError } = await supabase.from("automation_actions")
        .delete().eq("rule_id", rule.id).eq("organization_id", orgId!);
      if (actionError) throw new Error(actionError.message);
      const { error: ruleError } = await supabase.from("automation_rules")
        .delete().eq("id", rule.id).eq("organization_id", orgId!);
      if (ruleError) throw new Error(ruleError.message);
      const mediaPaths = (rule.config?.steps ?? [])
        .map((step) => step.storagePath)
        .filter((path): path is string => Boolean(path && path.startsWith(orgId + "/")));
      if (mediaPaths.length) {
        const { error: storageError } = await supabase.storage.from("automation-media").remove(mediaPaths);
        if (storageError) console.error("Falha ao limpar ficheiros da automação eliminada:", storageError.message);
      }
    },
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ["automations", orgId] }); },
    onError: (e: Error) => setError(e.message),
  });

  const rules = rulesQuery.data ?? [];

  return (
    <AppShell title="Automações" description="Respostas automáticas para mensagens recebidas no WhatsApp ligado por QR ou pela API oficial.">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2"><MessageSquareText className="size-5 text-primary" /><h2 className="font-display font-semibold">Criar automação</h2></div>
          {!canManage && <p className="rounded-md bg-secondary p-2 text-xs text-muted-foreground">Só OWNER ou ADMIN pode criar e gerir automações.</p>}
          <p className="text-sm text-muted-foreground">Palavras-chave e respostas fora de horário substituem a resposta da IA para evitar duplicações. A saudação de boas-vindas pode ser seguida pela resposta da IA. A distribuição automática atribui um responsável, mantendo a IA activa até alguém assumir o atendimento. A regra CRM cria uma oportunidade na primeira mensagem, sem duplicar uma oportunidade aberta do mesmo contacto.</p>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createRule.mutate(); }}>
            <div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-name">Nome da regra</label><Input id="automation-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Horário de funcionamento" maxLength={80} /></div>
            <div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-trigger">Quando deve executar?</label><select id="automation-trigger" value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)} className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="keyword_match">Palavra-chave</option><option value="conversation_created">Boas-vindas (primeira mensagem)</option><option value="outside_business_hours">Fora do horário de atendimento</option><option value="auto_assignment">Distribuição automática de conversa</option><option value="auto_crm_lead">Criar oportunidade no CRM</option></select></div>
            {triggerType === "keyword_match" && <div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-keyword">Palavra-chave ou expressão</label><Input id="automation-keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Ex.: menu, horário, localização" maxLength={100} /></div>}
            {triggerType === "outside_business_hours" && <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-start">Abre às</label><Input id="automation-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></div><div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-end">Fecha às</label><Input id="automation-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></div><p className="col-span-2 text-xs text-muted-foreground">Usa o fuso horário da organização e considera segunda a sexta-feira como dias de atendimento.</p></div>}
            {triggerType === "auto_assignment" ? <p className="rounded-md bg-secondary p-3 text-sm text-muted-foreground">A nova conversa será atribuída ao membro elegível com menos conversas abertas/em atendimento. Se não houver agentes, o sistema usa supervisor, administrador ou proprietário como alternativa. A IA continua a responder até um humano assumir.</p> : triggerType === "auto_crm_lead" ? <p className="rounded-md bg-secondary p-3 text-sm text-muted-foreground">Cria uma oportunidade na primeira mensagem recebida da conversa, na primeira etapa do CRM. Se o contacto já tiver uma oportunidade aberta, não cria outra.</p> : (
              <div className="space-y-3 rounded-lg border border-border bg-background/50 p-3">
                <div><h3 className="text-sm font-semibold">Construtor visual de etapas</h3><p className="text-xs text-muted-foreground">Arraste as etapas para mudar a ordem. Cada etapa pode enviar texto, uma imagem ou um áudio.</p></div>
                {steps.map((step, index) => (
                  <div key={step.id} draggable onDragStart={(e) => { setDraggingStepId(step.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", step.id); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
                    e.preventDefault();
                    const fromId = e.dataTransfer.getData("text/plain") || draggingStepId;
                    if (!fromId || fromId === step.id) return;
                    setSteps((current) => { const from = current.findIndex((item) => item.id === fromId); const to = current.findIndex((item) => item.id === step.id); if (from < 0 || to < 0) return current; const next = [...current]; const [moved] = next.splice(from, 1); if (moved) next.splice(to, 0, moved); return next; });
                    setDraggingStepId(null);
                  }} className={`space-y-2 rounded-md border p-3 ${draggingStepId === step.id ? "border-primary opacity-60" : "border-border"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2"><span className="cursor-grab text-muted-foreground" aria-label="Arrastar etapa">⠿</span><span className="text-xs font-semibold uppercase tracking-wide">Etapa {index + 1}</span></div>
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => setSteps((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })}>↑</Button>
                        <Button type="button" variant="ghost" size="sm" disabled={index === steps.length - 1} onClick={() => setSteps((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next; })}>↓</Button>
                        <Button type="button" variant="ghost" size="sm" disabled={steps.length === 1} onClick={() => setSteps((current) => current.filter((item) => item.id !== step.id))} aria-label="Remover etapa"><Trash2 className="size-4" /></Button>
                      </div>
                    </div>
                    <label className="text-xs font-medium" htmlFor={`step-kind-${step.id}`}>Tipo de ação</label>
                    <select id={`step-kind-${step.id}`} value={step.kind} onChange={(e) => setSteps((current) => current.map((item) => item.id === step.id ? { ...item, kind: e.target.value as AutomationStep["kind"], file: null } : item))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                      <option value="text">Enviar texto</option><option value="image">Enviar imagem</option><option value="audio">Enviar áudio</option>
                    </select>
                    {step.kind !== "text" && <div className="space-y-2"><label className="text-xs font-medium" htmlFor={"step-file-" + step.id}>{step.kind === "image" ? "Imagem (máx. 20 MB)" : "Áudio (máx. 20 MB)"}</label><Input id={"step-file-" + step.id} type="file" accept={step.kind === "image" ? "image/*" : "audio/*"} onChange={(e) => { const file = e.target.files?.[0] ?? null; const previewUrl = file && step.kind === "audio" ? URL.createObjectURL(file) : undefined; setSteps((current) => current.map((item) => item.id === step.id ? { ...item, file, ...(previewUrl ? { previewUrl } : {}), durationMs: undefined } : item)); if (file && step.kind === "audio" && previewUrl) { const audio = new Audio(); audio.preload = "metadata"; audio.onloadedmetadata = () => { const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined; setSteps((current) => current.map((item) => item.id === step.id ? { ...item, ...(durationMs ? { durationMs } : {}) } : item)); }; audio.src = previewUrl; } }} />{step.file && <p className="text-xs text-muted-foreground">{step.file.name} · {(step.file.size / (1024 * 1024)).toFixed(2)} MB{step.durationMs ? " · " + Math.floor(step.durationMs / 60000) + ":" + String(Math.floor(step.durationMs / 1000) % 60).padStart(2, "0") : ""}</p>}{step.kind === "audio" && <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={recordingStepId !== null && recordingStepId !== step.id} onClick={async () => { if (recordingStepId === step.id && recorderRef.current?.state === "recording") { recorderRef.current.stop(); return; } if (recordingStepId) return; if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("Este navegador não suporta gravação de áudio. Escolha um ficheiro."); return; } try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type)); const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream); recordingChunksRef.current = []; recorderRef.current = recorder; recordingStartedAtRef.current = Date.now(); recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); }; recorder.onerror = () => { stream.getTracks().forEach((track) => track.stop()); setRecordingStepId(null); setError("Não foi possível gravar o áudio. Verifique a permissão do microfone."); }; recorder.onstop = () => { const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" }); stream.getTracks().forEach((track) => track.stop()); recorderRef.current = null; setRecordingStepId(null); if (!blob.size) { setError("A gravação ficou vazia. Tente novamente."); return; } if (blob.size > 20 * 1024 * 1024) { setError("O áudio gravado ultrapassa 20 MB. Grave um áudio mais curto."); return; } const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm"; const file = new File([blob], "gravacao-" + Date.now() + "." + extension, { type: blob.type }); const previewUrl = URL.createObjectURL(file); setSteps((current) => current.map((item) => item.id === step.id ? { ...item, file, durationMs: Date.now() - recordingStartedAtRef.current, previewUrl } : item)); setError(null); }; recorder.start(250); setRecordingStepId(step.id); setError(null); } catch { setError("Não foi possível aceder ao microfone. Autorize o acesso nas permissões do navegador."); } }}>{recordingStepId === step.id ? "Parar gravação" : "Gravar áudio"}</Button>{recordingStepId === step.id && <span className="text-xs text-destructive">A gravar…</span>}</div>}{step.kind === "audio" && step.previewUrl && <audio className="w-full" controls preload="metadata" src={step.previewUrl}>O navegador não suporta a pré-escuta de áudio.</audio>}</div>}
                    {(step.kind === "text" || step.kind === "image") && <div className="space-y-1"><label className="text-xs font-medium" htmlFor={`step-content-${step.id}`}>{step.kind === "image" ? "Legenda (opcional)" : "Texto a enviar"}</label><Textarea id={`step-content-${step.id}`} value={step.content} onChange={(e) => setSteps((current) => current.map((item) => item.id === step.id ? { ...item, content: e.target.value } : item))} rows={step.kind === "text" ? 3 : 2} maxLength={2000} placeholder={step.kind === "image" ? "Legenda da imagem..." : "Escreva a mensagem..."} /></div>}
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSteps((current) => [...current, { id: crypto.randomUUID(), kind: "text", content: "", file: null }])}><Plus className="mr-1 size-4" /> Etapa de texto</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSteps((current) => [...current, { id: crypto.randomUUID(), kind: "image", content: "", file: null }])}><Plus className="mr-1 size-4" /> Etapa de imagem</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSteps((current) => [...current, { id: crypto.randomUUID(), kind: "audio", content: "", file: null }])}><Plus className="mr-1 size-4" /> Etapa de áudio</Button>
                </div>
              </div>
            )}
            {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">{notice}</p>}
            <Button type="submit" disabled={!orgId || !canManage || createRule.isPending} className="w-full sm:w-auto"><Plus className="mr-2 size-4" />{createRule.isPending ? "A guardar…" : "Criar automação"}</Button>
          </form>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2"><h2 className="font-display font-semibold">Regras da organização</h2><Badge variant="secondary">{rules.length}</Badge></div>
          {rulesQuery.isLoading ? <p className="text-sm text-muted-foreground">A carregar…</p> :
            rulesQuery.error ? <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{rulesQuery.error.message}</p> :
            rules.length === 0 ? <EmptyState icon={Workflow} title="Ainda sem automações" description="Crie uma regra acima e teste-a com uma conversa controlada." /> :
            <div className="space-y-3">{rules.map((rule) => (
              <article key={rule.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{rule.name}</h3><Badge variant={rule.is_active ? "default" : "secondary"}>{rule.is_active ? "Activa" : "Pausada"}</Badge></div><div className="mt-1 flex flex-wrap items-center gap-2"><Badge variant="outline">{rule.config?.actionType === "assign_agent" ? triggerLabels.auto_assignment : rule.config?.actionType === "create_deal" ? triggerLabels.auto_crm_lead : triggerLabels[rule.trigger_type as TriggerType] ?? "Tipo não suportado"}</Badge><p className="text-xs text-muted-foreground">{triggerDescription(rule)}</p></div></div>
                  <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" disabled={!canManage || toggleRule.isPending} onClick={() => toggleRule.mutate(rule)}><Power className="mr-1 size-4" />{rule.is_active ? "Pausar" : "Activar"}</Button><Button size="sm" variant="destructive" disabled={!canManage || deleteRule.isPending} onClick={() => { if (window.confirm("Eliminar esta automação?")) deleteRule.mutate(rule); }} aria-label={`Eliminar ${rule.name}`}><Trash2 className="size-4" /></Button></div>
                </div>
                {rule.trigger_type === "outside_business_hours" && <p className="text-xs text-muted-foreground"><Clock3 className="mr-1 inline size-3" />Segunda a sexta · {rule.config?.startTime ?? "09:00"}–{rule.config?.endTime ?? "18:00"}</p>}
                {rule.trigger_type === "conversation_created" && rule.config?.actionType !== "assign_agent" && rule.config?.actionType !== "create_deal" && <p className="text-xs text-muted-foreground"><Handshake className="mr-1 inline size-3" />Executa apenas na primeira mensagem da conversa.</p>}
                {rule.config?.actionType === "assign_agent" && <p className="text-xs text-muted-foreground"><UsersRound className="mr-1 inline size-3" />Atribuição por menor carga, sem eliminar a resposta da IA.</p>}
                {rule.config?.actionType === "create_deal" && <p className="text-xs text-muted-foreground"><Handshake className="mr-1 inline size-3" />Criação automática de oportunidade no CRM.</p>}
                <p className="whitespace-pre-wrap break-words rounded-lg bg-secondary/60 p-3 text-sm">{rule.config?.reply ?? (rule.config?.actionType === "assign_agent" ? "Acção: distribuir a conversa por um membro disponível." : rule.config?.actionType === "create_deal" ? "Acção: criar oportunidade no CRM." : "Esta regra não tem resposta configurada.")}</p>
              </article>
            ))}</div>}
          {error && !createRule.isError && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </section>
      </div>
    </AppShell>
  );
}
