import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { VEHICLE_SHARE_MESSAGE_TEMPLATES } from "@/lib/vehicle-share-message-templates";

export function VehicleShareMessageEditor({ value, onChange, disabled = false }: {
  value: string;
  onChange: (message: string) => void;
  disabled?: boolean;
}) {
  const [tab, setTab] = useState("message");
  const [selected, setSelected] = useState<string>(VEHICLE_SHARE_MESSAGE_TEMPLATES[0].id);
  const template = VEHICLE_SHARE_MESSAGE_TEMPLATES.find((item) => item.id === selected);

  function applyTemplate() {
    if (!template || disabled) return;
    onChange(template.message);
    setTab("message");
  }

  return (
    <section aria-label="Optional Message">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="vehicle-share-message" className="text-xs font-medium">Optional Message</label>
          <TabsList aria-label="Message Options">
            <TabsTrigger value="message">Message</TabsTrigger>
            <TabsTrigger value="templates"><FileText className="mr-1.5 h-3.5 w-3.5" />Templates</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="message">
          <Textarea id="vehicle-share-message" value={value} onChange={(event) => onChange(event.target.value)} maxLength={500} rows={3} disabled={disabled} placeholder="Add a short note for this recipient" className="resize-y bg-card text-foreground focus-visible:ring-brand" />
          {value && <div className="mt-2 flex justify-end"><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange("")} className="text-muted-foreground hover:bg-danger-soft hover:text-destructive"><Trash2 />Clear Message</Button></div>}
        </TabsContent>
        <TabsContent value="templates">
          <RadioGroup aria-label="Message Templates" value={selected} onValueChange={setSelected} disabled={disabled} className="gap-0 divide-y divide-border">
            {VEHICLE_SHARE_MESSAGE_TEMPLATES.map((item) => (
              <label key={item.id} className="flex cursor-pointer items-start gap-3 py-3">
                <RadioGroupItem value={item.id} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.message}</span>
                </div>
              </label>
            ))}
          </RadioGroup>
          <div className="mt-2 flex justify-end">
            <Button type="button" variant="secondary" size="sm" disabled={disabled || !template} onClick={applyTemplate}><FileText />{value.trim() ? "Replace Message" : "Use Template"}</Button>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}