import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  CalendarDays, CalendarClock, CalendarCheck, Clock, Package, Settings2,
  Plus, CheckCircle2, XCircle, CircleAlert, Loader2, RefreshCw, UserRound, ChevronLeft, ChevronRight,
} from "lucide-react";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import {
  getBookingWorkspace, saveBookingSettings, saveBookingService, saveBookingStaff, saveBookingResource,
  saveBookingSchedule, createDashboardBooking, updateDashboardBookingStatus,
} from "@/lib/booking.functions";

export const Route = createFileRoute("/_authenticated/agendamentos")({
  head: () => ({ meta: [{ title: "Agendamentos — WHAPPNUS" }, { name: "description", content: "Gestão inteligente de reservas e agendamentos da sua organização." }] }),
  component: BookingsPage,
});

const weekdays = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];
const statusLabels: Record<string,string> = {
  pending_confirmation:"A aguardar aprovação", confirmed:"Confirmado", in_progress:"Em atendimento",
  completed:"Concluído", cancelled:"Cancelado", no_show:"Não compareceu", expired:"Expirado",
};
const statusVariants: Record<string,"default"|"secondary"|"destructive"|"outline"> = {
  pending_confirmation:"outline", confirmed:"default", in_progress:"secondary", completed:"secondary",
  cancelled:"destructive", no_show:"destructive", expired:"outline",
};
type DayRule = { weekday:number; enabled:boolean; startsAt:string; endsAt:string };

function BookingsPage() {
  const { membership } = useAuth();
  const organizationId = membership?.organization_id;
  const role = membership?.role;
  const canManage = role === "OWNER" || role === "ADMIN";
  const canOperate = canManage || role === "SUPERVISOR";
  const queryClient = useQueryClient();
  const initializedSettingsFor = useRef<string | null>(null);
  const [weekOffset,setWeekOffset] = useState(0);
  const [serviceName,setServiceName] = useState("");
  const [serviceDescription,setServiceDescription] = useState("");
  const [serviceDuration,setServiceDuration] = useState("60");
  const [serviceCapacity,setServiceCapacity] = useState("1");
  const [servicePrice,setServicePrice] = useState("");
  const [serviceConfirmationMode,setServiceConfirmationMode] = useState<""|"automatic"|"manual">("");
  const [staffName,setStaffName] = useState("");
  const [staffServiceIds,setStaffServiceIds] = useState<string[]>([]);
  const [staffServicesInitialized,setStaffServicesInitialized] = useState(false);
  const [resourceName,setResourceName] = useState("");
  const [resourceType,setResourceType] = useState<"room"|"table"|"equipment"|"vehicle"|"space"|"other">("room");
  const [resourceService,setResourceService] = useState("");
  const [bookingResource,setBookingResource] = useState("");
  const [bookingService,setBookingService] = useState("");
  const [bookingContact,setBookingContact] = useState("");
  const [bookingStaff,setBookingStaff] = useState("");
  const [bookingStart,setBookingStart] = useState("");
  const [bookingNotes,setBookingNotes] = useState("");
  const [days,setDays] = useState<DayRule[]>(weekdays.map((_,weekday)=>({weekday,enabled:weekday>0&&weekday<6,startsAt:"09:00",endsAt:"18:00"})));
  const [enabled,setEnabled] = useState(false);
  const [confirmationMode,setConfirmationMode] = useState<"automatic"|"manual">("automatic");
  const [minNotice,setMinNotice] = useState("60");
  const [maxDays,setMaxDays] = useState("60");
  const [pendingExpiry,setPendingExpiry] = useState("30");
  const [allowCancel,setAllowCancel] = useState(true);
  const [allowReschedule,setAllowReschedule] = useState(true);

  const workspace = useQuery({
    queryKey:["booking-workspace",organizationId],
    enabled:Boolean(organizationId),
    queryFn:()=>getBookingWorkspace({data:{organizationId:organizationId!}}),
    refetchInterval:30000,
  });
  const data = workspace.data;
  const services = data?.services ?? [];
  const staff = data?.staff ?? [];
  const bookings = data?.bookings ?? [];
  const activeBookings = bookings.filter(b=>["pending_confirmation","confirmed","in_progress"].includes(b.status));
  const pendingCount = bookings.filter(b=>b.status==="pending_confirmation").length;
  const confirmedCount = bookings.filter(b=>b.status==="confirmed").length;
  const timezone=data?.organization?.timezone??"Africa/Luanda";
  const today = new Date().toLocaleDateString("en-CA",{timeZone:timezone});
  const [yearPart="2026",monthPart="1",dayPart="1"]=today.split("-");
  const year=Number(yearPart),month=Number(monthPart),day=Number(dayPart);
  const weekStart=new Date(Date.UTC(year,month-1,day));
  weekStart.setUTCDate(weekStart.getUTCDate()-((weekStart.getUTCDay()+6)%7)+weekOffset*7);
  const weekDays=Array.from({length:7},(_,index)=>{
    const date=new Date(weekStart);date.setUTCDate(weekStart.getUTCDate()+index);
    const key=date.toISOString().slice(0,10);
    return {key,label:new Intl.DateTimeFormat("pt-AO",{weekday:"short",day:"2-digit",month:"short",timeZone:timezone}).format(new Date(key+"T12:00:00Z"))};
  });
  const todayCount = bookings.filter(b=>new Date(b.starts_at).toLocaleDateString("en-CA",{timeZone:data?.organization?.timezone??"Africa/Luanda"})===today).length;

  useEffect(()=>{
    if(!data || initializedSettingsFor.current===organizationId) return;
    initializedSettingsFor.current=organizationId;
    setEnabled(Boolean(data.settings.enabled));
    setConfirmationMode(data.settings.confirmation_mode==="manual"?"manual":"automatic");
    setMinNotice(String(data.settings.min_notice_minutes??60));
    setMaxDays(String(data.settings.max_days_ahead??60));
    setPendingExpiry(String(data.settings.pending_expiry_minutes??30));
    setAllowCancel(Boolean(data.settings.allow_customer_cancel));
    setAllowReschedule(Boolean(data.settings.allow_customer_reschedule));
    const orgRules=data.rules.filter(r=>r.scope_type==="organization");
    if(orgRules.length) setDays(weekdays.map((_,weekday)=>{
      const rule=orgRules.find(r=>r.weekday===weekday);
      return {weekday,enabled:Boolean(rule),startsAt:rule?.starts_at?.slice(0,5)??"09:00",endsAt:rule?.ends_at?.slice(0,5)??"18:00"};
    }));
  },[data,organizationId]);

  useEffect(()=>{
    if(!staffServicesInitialized&&services.length){
      setStaffServiceIds(services.filter(s=>s.is_active).map(s=>s.id));
      setStaffServicesInitialized(true);
    }
  },[services,staffServicesInitialized]);
  const refresh=()=>queryClient.invalidateQueries({queryKey:["booking-workspace",organizationId]});
  const serviceMutation=useMutation({
    mutationFn:()=>saveBookingService({data:{organizationId:organizationId!,name:serviceName,description:serviceDescription,durationMinutes:Number(serviceDuration),bufferBeforeMinutes:0,bufferAfterMinutes:0,priceAmount:servicePrice?Number(servicePrice):null,capacity:Number(serviceCapacity),confirmationMode:serviceConfirmationMode||null,isActive:true}}),
    onSuccess:()=>{toast.success("Serviço criado.");setServiceName("");setServiceDescription("");setServiceDuration("60");setServiceCapacity("1");setServicePrice("");setServiceConfirmationMode("");void refresh();},
    onError:(e:Error)=>toast.error(e.message),
  });
  const staffMutation=useMutation({
    mutationFn:()=>saveBookingStaff({data:{organizationId:organizationId!,displayName:staffName,serviceIds:staffServiceIds,isActive:true}}),
    onSuccess:()=>{toast.success("Profissional adicionado.");setStaffName("");void refresh();},
    onError:(e:Error)=>toast.error(e.message),
  });
  const resourceMutation=useMutation({
    mutationFn:()=>saveBookingResource({data:{organizationId:organizationId!,name:resourceName,resourceType,capacity:1,serviceIds:resourceService?[resourceService]:services.filter(s=>s.is_active).map(s=>s.id),isActive:true}}),
    onSuccess:()=>{toast.success("Recurso adicionado.");setResourceName("");setResourceService("");void refresh();},
    onError:(e:Error)=>toast.error(e.message),
  });
  const scheduleMutation=useMutation({
    mutationFn:()=>saveBookingSchedule({data:{organizationId:organizationId!,days}}),
    onSuccess:()=>{toast.success("Horário de funcionamento guardado.");void refresh();},
    onError:(e:Error)=>toast.error(e.message),
  });
  const settingsMutation=useMutation({
    mutationFn:()=>saveBookingSettings({data:{organizationId:organizationId!,enabled,confirmationMode,minNoticeMinutes:Number(minNotice),maxDaysAhead:Number(maxDays),pendingExpiryMinutes:Number(pendingExpiry),allowCustomerCancel:allowCancel,allowCustomerReschedule:allowReschedule,reminder24h:false,reminder2h:false}}),
    onSuccess:()=>{toast.success("Configurações guardadas.");void refresh();},
    onError:(e:Error)=>toast.error(e.message),
  });
  const createMutation=useMutation({
    mutationFn:()=>createDashboardBooking({data:{organizationId:organizationId!,contactId:bookingContact||null,serviceId:bookingService,staffId:bookingStaff||null,resourceId:bookingResource||null,startsAtLocal:bookingStart,customerNotes:bookingNotes}}),
    onSuccess:()=>{toast.success("Pedido de agendamento registado.");setBookingStart("");setBookingNotes("");void refresh();},
    onError:(e:Error)=>toast.error(e.message),
  });
  const statusMutation=useMutation({
    mutationFn:({bookingId,status}:{bookingId:string;status:"confirmed"|"in_progress"|"completed"|"cancelled"|"no_show"})=>updateDashboardBookingStatus({data:{organizationId:organizationId!,bookingId,status}}),
    onSuccess:()=>{toast.success("Estado do agendamento actualizado.");void refresh();},
    onError:(e:Error)=>toast.error(e.message),
  });

  const orderedBookings=useMemo(()=>[...bookings].sort((a,b)=>a.starts_at.localeCompare(b.starts_at)),[bookings]);
  const fmt=(value:string)=>new Intl.DateTimeFormat("pt-AO",{dateStyle:"medium",timeStyle:"short",timeZone:data?.organization?.timezone??"Africa/Luanda"}).format(new Date(value));
  const serviceNameFor=(id:string)=>services.find(s=>s.id===id)?.name??"Serviço";
  const contactNameFor=(id:string|null)=>data?.contacts.find(c=>c.id===id)?.full_name??"Cliente sem nome";

  if(!organizationId) return <AppShell title="Agendamentos"><p className="text-sm text-muted-foreground">Não foi encontrada uma organização activa.</p></AppShell>;
  return (
    <AppShell title="Agendamentos" description="Calendário e reservas inteligentes ligados ao WhatsApp"
      actions={<Button size="sm" variant="outline" onClick={()=>void refresh()} disabled={workspace.isFetching}><RefreshCw className={workspace.isFetching?"size-4 animate-spin":"size-4"}/> Actualizar</Button>}>
      {workspace.isLoading ? <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>A carregar agendamentos…</div> :
      workspace.error ? <Card><CardContent className="p-6 text-sm text-destructive">{(workspace.error as Error).message}</CardContent></Card> :
      !data ? <div className="py-16 text-sm text-muted-foreground">Não foi possível carregar os dados dos agendamentos.</div> :
      <>
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={CalendarDays} label="Marcações de hoje" value={todayCount}/>
          <Metric icon={CalendarCheck} label="Confirmados" value={confirmedCount}/>
          <Metric icon={CircleAlert} label="Aguardam aprovação" value={pendingCount}/>
          <Metric icon={Clock} label="Reservas activas" value={activeBookings.length}/>
        </div>
        {!data?.settings.enabled && <div className="mb-5 flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold">Agendamentos ainda não estão activos</p><p className="text-xs text-muted-foreground">Configura os serviços e horários, depois activa a funcionalidade nas definições.</p></div>
          <Badge variant="outline">Configuração necessária</Badge>
        </div>}
        <Tabs defaultValue="agenda" className="space-y-5">
          <TabsList className="h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="agenda">Agenda</TabsTrigger><TabsTrigger value="reservas">Reservas</TabsTrigger>
            <TabsTrigger value="servicos">Serviços</TabsTrigger><TabsTrigger value="equipa">Equipa</TabsTrigger>
            <TabsTrigger value="recursos">Recursos</TabsTrigger><TabsTrigger value="horarios">Horários</TabsTrigger><TabsTrigger value="configuracoes">Configurações</TabsTrigger>
          </TabsList>
          <TabsContent value="agenda" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionHeading title="Calendário semanal" description="Visualiza os compromissos por dia, no fuso horário da organização."/>
              <div className="flex items-center gap-2"><Button size="icon" variant="outline" onClick={()=>setWeekOffset(v=>v-1)} aria-label="Semana anterior"><ChevronLeft className="size-4"/></Button><Button size="sm" variant="outline" onClick={()=>setWeekOffset(0)}>Hoje</Button><Button size="icon" variant="outline" onClick={()=>setWeekOffset(v=>v+1)} aria-label="Próxima semana"><ChevronRight className="size-4"/></Button></div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <div className="grid min-w-[840px] grid-cols-7 divide-x divide-border">
                {weekDays.map(day=><div key={day.key} className="min-h-44 p-2">
                  <div className={`mb-2 rounded-lg px-2 py-1 text-center text-xs font-semibold uppercase ${day.key===today?"bg-primary/10 text-primary":"bg-secondary text-muted-foreground"}`}>{day.label}</div>
                  <div className="space-y-2">
                    {orderedBookings.filter(b=>new Date(b.starts_at).toLocaleDateString("en-CA",{timeZone:timezone})===day.key&&b.status!=="cancelled"&&b.status!=="expired").map(b=><div key={b.id} className="rounded-lg border border-border bg-card p-2">
                      <p className="text-xs font-semibold">{new Date(b.starts_at).toLocaleTimeString("pt-AO",{hour:"2-digit",minute:"2-digit",timeZone:timezone})}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs">{serviceNameFor(b.service_id)}</p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{contactNameFor(b.contact_id)}</p>
                      <Badge className="mt-1 max-w-full" variant={statusVariants[b.status]??"outline"}>{statusLabels[b.status]??b.status}</Badge>
                    </div>)}
                    {!orderedBookings.some(b=>new Date(b.starts_at).toLocaleDateString("en-CA",{timeZone:timezone})===day.key&&b.status!=="cancelled"&&b.status!=="expired")&&<p className="px-1 py-4 text-center text-[10px] text-muted-foreground">Sem reservas</p>}
                  </div>
                </div>)}
              </div>
            </div>
            <SectionHeading title="Próximos compromissos" description="Acompanhe as reservas e o estado de cada atendimento."/>

            {orderedBookings.filter(b=>new Date(b.starts_at)>=new Date()&&b.status!=="cancelled").slice(0,12).map(b=><BookingRow key={b.id} booking={b} fmt={fmt} serviceName={serviceNameFor(b.service_id)} contactName={contactNameFor(b.contact_id)} canOperate={canOperate} busy={statusMutation.isPending} onStatus={(status)=>statusMutation.mutate({bookingId:b.id,status})}/>)}
            {!orderedBookings.some(b=>new Date(b.starts_at)>=new Date()&&b.status!=="cancelled")&&<EmptyPanel title="Ainda não existem agendamentos" text="Quando a IA ou a equipa criar uma marcação, ela aparecerá aqui."/>}
          </TabsContent>
          <TabsContent value="reservas" className="space-y-4">
            <SectionHeading title="Todas as reservas" description="Crie marcações manualmente ou acompanhe as que chegam pelo WhatsApp."/>
            {canOperate&&<Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="size-4 text-primary"/>Nova marcação</CardTitle><CardDescription>O sistema valida o horário e impede conflitos com reservas existentes.</CardDescription></CardHeader>
              <CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Serviço"><Select value={bookingService} onValueChange={setBookingService}><SelectTrigger><SelectValue placeholder="Escolher serviço"/></SelectTrigger><SelectContent>{services.filter(s=>s.is_active).map(s=><SelectItem key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Cliente"><Select value={bookingContact} onValueChange={setBookingContact}><SelectTrigger><SelectValue placeholder="Escolher contacto"/></SelectTrigger><SelectContent>{data.contacts.map(c=><SelectItem key={c.id} value={c.id}>{c.full_name||c.phone_e164}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Profissional (opcional)"><Select value={bookingStaff||"any"} onValueChange={v=>setBookingStaff(v==="any"?"":v)}><SelectTrigger><SelectValue placeholder="Qualquer disponível"/></SelectTrigger><SelectContent><SelectItem value="any">Qualquer disponível</SelectItem>{staff.filter(s=>s.is_active).map(s=><SelectItem key={s.id} value={s.id}>{s.display_name}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Recurso (opcional)"><Select value={bookingResource||"none"} onValueChange={v=>setBookingResource(v==="none"?"":v)}><SelectTrigger><SelectValue placeholder="Sem recurso específico"/></SelectTrigger><SelectContent><SelectItem value="none">Sem recurso específico</SelectItem>{data.resources.filter(r=>r.is_active).map(r=><SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Data e hora"><Input type="datetime-local" value={bookingStart} onChange={e=>setBookingStart(e.target.value)}/></Field>
                <Field label="Observações"><Input value={bookingNotes} onChange={e=>setBookingNotes(e.target.value)} placeholder="Informação adicional"/></Field>
                <div className="flex items-end"><Button className="w-full" disabled={!canOperate||!data.settings.enabled||!bookingService||!bookingStart||createMutation.isPending} onClick={()=>createMutation.mutate()}>{createMutation.isPending?<Loader2 className="size-4 animate-spin"/>:<Plus className="size-4"/>}Criar marcação</Button></div>
              </div></CardContent></Card>}
            <div className="space-y-2">{orderedBookings.map(b=><BookingRow key={b.id} booking={b} fmt={fmt} serviceName={serviceNameFor(b.service_id)} contactName={contactNameFor(b.contact_id)} canOperate={canOperate} busy={statusMutation.isPending} onStatus={(status)=>statusMutation.mutate({bookingId:b.id,status})}/>)}</div>
          </TabsContent>
          <TabsContent value="servicos" className="space-y-4">
            <SectionHeading title="Catálogo de serviços" description="Define o que os clientes podem marcar, a duração e o preço informativo."/>
            {canManage&&<Card><CardHeader><CardTitle className="text-base">Adicionar serviço</CardTitle></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Nome"><Input value={serviceName} onChange={e=>setServiceName(e.target.value)} placeholder="Ex.: Consulta de avaliação"/></Field>
              <Field label="Duração (minutos)"><Input type="number" min="5" value={serviceDuration} onChange={e=>setServiceDuration(e.target.value)}/></Field>
              <Field label="Capacidade simultânea"><Input type="number" min="1" max="1000" value={serviceCapacity} onChange={e=>setServiceCapacity(e.target.value)}/></Field>
              <Field label="Preço informativo (opcional)"><Input type="number" min="0" value={servicePrice} onChange={e=>setServicePrice(e.target.value)} placeholder="Valor na moeda da empresa"/></Field>
              <Field label="Confirmação"><Select value={serviceConfirmationMode||"inherit"} onValueChange={v=>setServiceConfirmationMode(v==="inherit"?"":v as "automatic"|"manual")}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="inherit">Usar regra geral</SelectItem><SelectItem value="automatic">Automática</SelectItem><SelectItem value="manual">Aprovação da equipa</SelectItem></SelectContent></Select></Field>
              <div className="flex items-end"><Button className="w-full" disabled={!serviceName.trim()||serviceMutation.isPending} onClick={()=>serviceMutation.mutate()}><Plus className="size-4"/>Adicionar serviço</Button></div>
              <div className="md:col-span-2 xl:col-span-4"><Field label="Descrição"><Textarea value={serviceDescription} onChange={e=>setServiceDescription(e.target.value)} placeholder="Descreve o serviço e o que o cliente deve saber."/></Field></div>
            </div></CardContent></Card>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{services.map(s=><Card key={s.id}><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{s.name}</p><p className="mt-1 text-xs text-muted-foreground">{s.description||"Sem descrição"}</p></div><Badge variant={s.is_active?"default":"secondary"}>{s.is_active?"Activo":"Inactivo"}</Badge></div><div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Clock className="size-3"/> {s.duration_minutes} min</span><span>{s.price_amount!=null?Number(s.price_amount).toLocaleString("pt-AO")+" "+(data.organization?.currency??"AOA"):"Preço sob consulta"}</span></div></CardContent></Card>)}</div>
            {!services.length&&<EmptyPanel title="Nenhum serviço cadastrado" text="Adiciona o primeiro serviço para começares a receber marcações."/>}
          </TabsContent>
          <TabsContent value="equipa" className="space-y-4">
            <SectionHeading title="Profissionais e equipa" description="Associa funcionários aos serviços que podem executar."/>
            {canManage&&<Card><CardHeader><CardTitle className="text-base">Adicionar profissional</CardTitle></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-[1fr_auto]"><Field label="Nome do profissional"><Input value={staffName} onChange={e=>setStaffName(e.target.value)} placeholder="Nome"/></Field><div className="flex items-end"><Button disabled={!staffName.trim()||staffMutation.isPending} onClick={()=>staffMutation.mutate()}><Plus className="size-4"/>Adicionar</Button></div></div><div className="mt-4 space-y-2"><Label>Serviços que este profissional pode executar</Label><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{services.filter(s=>s.is_active).map(s=><label key={s.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm"><Checkbox checked={staffServiceIds.includes(s.id)} onCheckedChange={checked=>setStaffServiceIds(old=>checked===true?[...old,s.id]:old.filter(id=>id!==s.id))}/>{s.name}</label>)}</div></div></CardContent></Card>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{staff.map(s=><Card key={s.id}><CardContent className="flex items-center gap-3 p-4"><div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><UserRound className="size-5"/></div><div className="min-w-0 flex-1"><p className="font-semibold">{s.display_name}</p><p className="text-xs text-muted-foreground">{s.description||"Profissional da equipa"}</p></div><Badge variant={s.is_active?"default":"secondary"}>{s.is_active?"Activo":"Inactivo"}</Badge></CardContent></Card>)}</div>
            {!staff.length&&<EmptyPanel title="Sem profissionais registados" text="Podes começar sem equipa ou adicionar os profissionais que atendem os clientes."/>}
          </TabsContent>
          <TabsContent value="recursos" className="space-y-4">
            <SectionHeading title="Recursos reserváveis" description="Salas, mesas, equipamentos, viaturas ou espaços necessários para determinados serviços."/>
            {canManage&&<Card><CardHeader><CardTitle className="text-base">Adicionar recurso</CardTitle></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-3">
              <Field label="Nome"><Input value={resourceName} onChange={e=>setResourceName(e.target.value)} placeholder="Ex.: Sala 1, Mesa 4, Viatura A"/></Field>
              <Field label="Tipo"><Select value={resourceType} onValueChange={v=>setResourceType(v as typeof resourceType)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="room">Sala</SelectItem><SelectItem value="table">Mesa</SelectItem><SelectItem value="equipment">Equipamento</SelectItem><SelectItem value="vehicle">Viatura</SelectItem><SelectItem value="space">Espaço</SelectItem><SelectItem value="other">Outro</SelectItem></SelectContent></Select></Field>
              <Field label="Serviço associado"><Select value={resourceService||"all"} onValueChange={v=>setResourceService(v==="all"?"":v)}><SelectTrigger><SelectValue placeholder="Todos os serviços"/></SelectTrigger><SelectContent><SelectItem value="all">Todos os serviços</SelectItem>{services.map(s=><SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></Field>
              
              <div className="md:col-span-3 flex justify-end"><Button disabled={!resourceName.trim()||resourceMutation.isPending} onClick={()=>resourceMutation.mutate()}><Plus className="size-4"/>Adicionar recurso</Button></div>
            </div></CardContent></Card>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.resources.map(r=><Card key={r.id}><CardContent className="flex items-center gap-3 p-4"><div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Package className="size-5"/></div><div className="min-w-0 flex-1"><p className="font-semibold">{r.name}</p><p className="text-xs text-muted-foreground">{r.resource_type} · Capacidade {r.capacity}</p></div><Badge variant={r.is_active?"default":"secondary"}>{r.is_active?"Activo":"Inactivo"}</Badge></CardContent></Card>)}</div>
            {!data.resources.length&&<EmptyPanel title="Sem recursos registados" text="Adiciona salas, mesas, equipamentos ou outros recursos quando o teu negócio precisar de controlar a disponibilidade deles."/>}
          </TabsContent>
          <TabsContent value="horarios" className="space-y-4">
            <SectionHeading title="Horário de funcionamento" description="Define os dias e as horas em que a organização aceita marcações."/>
            <Card><CardContent className="space-y-3 p-4">{days.map(day=><div key={day.weekday} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border pb-3 last:border-0"><div className="flex items-center gap-3"><Switch checked={day.enabled} onCheckedChange={checked=>setDays(old=>old.map(d=>d.weekday===day.weekday?{...d,enabled:checked}:d))}/><span className="text-sm font-medium">{weekdays[day.weekday]}</span></div><Input className="w-28" type="time" disabled={!day.enabled} value={day.startsAt} onChange={e=>setDays(old=>old.map(d=>d.weekday===day.weekday?{...d,startsAt:e.target.value}:d))}/><Input className="w-28" type="time" disabled={!day.enabled} value={day.endsAt} onChange={e=>setDays(old=>old.map(d=>d.weekday===day.weekday?{...d,endsAt:e.target.value}:d))}/></div>)}
              {canManage&&<div className="flex justify-end pt-2"><Button disabled={scheduleMutation.isPending} onClick={()=>scheduleMutation.mutate()}>{scheduleMutation.isPending?<Loader2 className="size-4 animate-spin"/>:null}Guardar horários</Button></div>}
            </CardContent></Card>
            <p className="text-xs text-muted-foreground">Os horários são interpretados no fuso horário da organização: {data.organization?.timezone??"Africa/Luanda"}. Pausas e feriados podem ser adicionados numa evolução posterior.</p>
          </TabsContent>
          <TabsContent value="configuracoes" className="space-y-4">
            <SectionHeading title="Configurações dos agendamentos" description="Define como a IA e a equipa devem gerir as marcações."/>
            <Card><CardHeader><CardTitle className="text-base">Funcionamento geral</CardTitle><CardDescription>Estas definições são aplicadas à organização. O serviço pode ter regras específicas.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <SettingRow title="Activar agendamentos" description="Permite à equipa e à IA criar reservas."><Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canManage}/></SettingRow>
                <div className="grid gap-3 sm:grid-cols-2"><Field label="Modo de confirmação"><Select value={confirmationMode} onValueChange={v=>setConfirmationMode(v as "automatic"|"manual")} disabled={!canManage}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="automatic">Automática</SelectItem><SelectItem value="manual">Aprovação da equipa</SelectItem></SelectContent></Select></Field>
                  <Field label="Expiração de pedidos pendentes (min)"><Input type="number" min="5" value={pendingExpiry} onChange={e=>setPendingExpiry(e.target.value)} disabled={!canManage}/></Field>
                  <Field label="Antecedência mínima (min)"><Input type="number" min="0" value={minNotice} onChange={e=>setMinNotice(e.target.value)} disabled={!canManage}/></Field>
                  <Field label="Máximo de dias para marcar"><Input type="number" min="1" value={maxDays} onChange={e=>setMaxDays(e.target.value)} disabled={!canManage}/></Field>
                </div>
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <SettingRow title="Permitir cancelamento pelo cliente" description="A IA poderá processar pedidos de cancelamento."><Switch checked={allowCancel} onCheckedChange={setAllowCancel} disabled={!canManage}/></SettingRow>
                  <SettingRow title="Permitir remarcação pelo cliente" description="A IA poderá procurar uma nova data e hora."><Switch checked={allowReschedule} onCheckedChange={setAllowReschedule} disabled={!canManage}/></SettingRow>
                  <p className="text-xs text-muted-foreground">Os lembretes automáticos por WhatsApp serão activados numa fase seguinte, depois de instalado e validado o serviço de envio programado.</p>
                </div>
                {canManage&&<div className="flex justify-end"><Button disabled={settingsMutation.isPending} onClick={()=>settingsMutation.mutate()}>{settingsMutation.isPending?<Loader2 className="size-4 animate-spin"/>:null}Guardar configurações</Button></div>}
              </CardContent>
            </Card>
            <Card><CardHeader><CardTitle className="text-base">Integração com a IA</CardTitle><CardDescription>As ferramentas de agendamento da IA só poderão operar quando esta funcionalidade estiver activa e as permissões forem autorizadas na aba IA.</CardDescription></CardHeader><CardContent><div className="flex items-center gap-2 text-sm text-muted-foreground"><Settings2 className="size-4 text-primary"/>A configuração de permissões do agente será apresentada na secção de IA.</div></CardContent></Card>
          </TabsContent>
        </Tabs>
      </>}
    </AppShell>
  );
}

function Metric({icon:Icon,label,value}:{icon:typeof CalendarDays;label:string;value:number}) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5"/></div><div><p className="text-2xl font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></CardContent></Card>;
}
function Field({label,children}:{label:string;children:ReactNode}) { return <div className="min-w-0 space-y-1.5"><Label>{label}</Label>{children}</div>; }
function SectionHeading({title,description}:{title:string;description:string}) { return <div><h2 className="font-display text-lg font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div>; }
function SettingRow({title,description,children}:{title:string;description:string;children:React.ReactNode}) { return <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div>{children}</div>; }
function EmptyPanel({title,text}:{title:string;text:string}) { return <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center"><CalendarDays className="mx-auto mb-2 size-7 text-muted-foreground"/><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{text}</p></div>; }
function BookingRow({booking,fmt,serviceName,contactName,canOperate,busy,onStatus}:{booking:any;fmt:(value:string)=>string;serviceName:string;contactName:string;canOperate:boolean;busy:boolean;onStatus:(status:"confirmed"|"in_progress"|"completed"|"cancelled"|"no_show")=>void}) {
  return <Card><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarClock className="size-5"/></div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{serviceName}</p><Badge variant={statusVariants[booking.status]??"outline"}>{statusLabels[booking.status]??booking.status}</Badge></div>
      <p className="mt-1 text-sm text-muted-foreground">{contactName} · {fmt(booking.starts_at)}</p>
      <p className="text-xs text-muted-foreground">{booking.booking_code} · {booking.source==="ai"?"Criado pela IA":booking.source==="dashboard"?"Criado no painel":"Criado pela equipa"}</p>
    </div>
    {canOperate&&<div className="flex flex-wrap gap-2">
      {booking.status==="pending_confirmation"&&<Button size="sm" disabled={busy} onClick={()=>onStatus("confirmed")}><CheckCircle2 className="size-3.5"/>Aprovar</Button>}
      {booking.status==="confirmed"&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>onStatus("in_progress")}>Iniciar</Button>}{booking.status==="in_progress"&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>onStatus("completed")}>Concluir</Button>}
      {["pending_confirmation","confirmed","in_progress"].includes(booking.status)&&<Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={()=>onStatus("cancelled")}><XCircle className="size-3.5"/>Cancelar</Button>}
    </div>}
  </CardContent></Card>;
}
