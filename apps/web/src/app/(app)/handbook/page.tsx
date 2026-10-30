'use client';
import { Plus } from 'lucide-react';
import { PageTop } from '@/components/page-top';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert, Badge, Empty, Skeleton } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useList, useSave } from '@/hooks/api';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import type { HandbookSection } from '@/lib/types';

/** Plain text with "## heading", "- bullet" and blank-line paragraphs. Never interpreted as HTML. */
function Rendered({ body }: { body: string }) {
  const out: { t: 'h' | 'p' | 'li'; s: string }[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: 'p', s: para.join(' ') });
    para = [];
  };
  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) flush();
    else if (/^#{1,3}\s+/.test(line)) {
      flush();
      out.push({ t: 'h', s: line.replace(/^#{1,3}\s+/, '') });
    } else if (/^[-*•]\s+/.test(line)) {
      flush();
      out.push({ t: 'li', s: line.replace(/^[-*•]\s+/, '') });
    } else para.push(line);
  }
  flush();
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {out.map((b, i) =>
        b.t === 'h' ? (
          <h4 key={i} className="pt-1 font-semibold">
            {b.s}
          </h4>
        ) : b.t === 'li' ? (
          <p key={i} className="flex gap-2">
            <span className="text-primary">•</span>
            <span>{b.s}</span>
          </p>
        ) : (
          <p key={i}>{b.s}</p>
        ),
      )}
    </div>
  );
}

export default function HandbookPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const manage = can('handbook:manage');
  const [editing, setEditing] = useState<HandbookSection | 'new'>();
  const q = useList<HandbookSection>(
    'handbook',
    '/handbook',
    manage ? { includeDrafts: 'true' } : {},
  );
  const items = [...(q.data?.data ?? [])].sort((a, b) => a.order - b.order);
  return (
    <>
      <PageTop
        scope={manage ? 'edit and publish' : 'read'}
        stats={[
          { label: 'Sections', value: items.length },
          {
            label: 'Published',
            value: items.filter((i) => i.status === 'PUBLISHED').length,
            tone: 'success',
          },
          ...(manage
            ? [
                {
                  label: 'Drafts',
                  value: items.filter((i) => i.status === 'DRAFT').length,
                  sub: 'Only editors see these',
                },
              ]
            : []),
        ]}
        guide={[
          'The handbook is the company policy everyone can read.',
          manage
            ? 'Add a section, write it, then publish. Drafts stay hidden from employees until published.'
            : 'Sections are published by HR. Ask them if something is missing.',
        ]}
        title={t('hb.title')}
        description={t('hb.desc')}
        actions={
          manage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden /> {t('hb.add')}
            </Button>
          ) : undefined
        }
      />
      {q.isError ? <Alert tone="danger">{userMessage(q.error)}</Alert> : null}
      {!q.data ? (
        q.isError ? null : (
          <Skeleton className="h-40" />
        )
      ) : items.length === 0 ? (
        <Empty>
          {manage
            ? 'No sections yet. Add the first one.'
            : 'HR has not published any sections yet.'}
        </Empty>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <details
              key={s.id}
              className="group rounded-2xl border border-border bg-card p-4 shadow-card"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
                {s.title}
                {manage ? (
                  <Badge tone={s.status === 'PUBLISHED' ? 'success' : 'warn'}>
                    {s.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                  </Badge>
                ) : null}
                {manage ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditing(s);
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
              </summary>
              <div className="mt-3 border-t border-border pt-3">
                <Rendered body={s.body} />
              </div>
            </details>
          ))}
        </div>
      )}
      {editing ? (
        <SectionForm
          section={editing === 'new' ? undefined : editing}
          nextOrder={items.length}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}

function SectionForm({
  section,
  nextOrder,
  onClose,
}: {
  section?: HandbookSection;
  nextOrder: number;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(section?.title ?? '');
  const [body, setBody] = useState(section?.body ?? '');
  const [order, setOrder] = useState(String(section?.order ?? nextOrder));
  const [status, setStatus] = useState<'DRAFT' | 'PUBLISHED'>(section?.status ?? 'DRAFT');
  const [localError, setLocalError] = useState<string>();
  const save = useSave(
    () => {
      const payload = { title: title.trim(), body: body.trim(), order: Number(order), status };
      return section
        ? api.patch(`/handbook/${section.id}`, payload)
        : api.post('/handbook', payload);
    },
    ['handbook'],
    onClose,
  );
  const remove = useSave(() => api.del(`/handbook/${section!.id}`), ['handbook'], onClose);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={section ? 'Edit section' : 'Add section'}
      description="Plain text. Start a line with ## for a heading or - for a bullet; separate paragraphs with a blank line."
    >
      <div className="space-y-3">
        {localError || save.error || remove.error ? (
          <Alert tone="danger">{localError ?? save.error ?? remove.error}</Alert>
        ) : null}
        <Field label="Title">
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Text">
          {(id) => (
            <Textarea id={id} rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Order" hint="Smaller numbers come first.">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
              />
            )}
          </Field>
          <Field label="Visibility">
            {(id) => (
              <Select
                id={id}
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="DRAFT">Draft (only HR sees it)</option>
                <option value="PUBLISHED">Published (employees see it)</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="flex justify-between gap-2">
          {section ? (
            <Button
              variant="secondary"
              loading={remove.isPending}
              onClick={() => window.confirm('Delete this section?') && remove.mutate(undefined)}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              onClick={() =>
                title.trim().length >= 2 && body.trim() && /^\d+$/.test(order)
                  ? save.mutate(undefined)
                  : setLocalError('Add a title, some text and a whole-number order.')
              }
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
