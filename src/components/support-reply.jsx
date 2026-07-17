import React, { useState } from 'react';
import { Box, Label, TextArea, Button, MessageBox } from '@adminjs/design-system';
import { ApiClient, useNotice, useTranslation } from 'adminjs';

// The inline "Reply" form on a support ticket. It only collects the text and
// hands it to the `reply` record action — all the rules (turn check, insert,
// turn flip, audit) live server-side in src/actions/support.js, so this stays a
// dumb input.
const api = new ApiClient();

// The same short reference the user sees in the app, so when someone quotes
// "#3F9A2B1C" both sides are looking at the same string. Derived from the id, so
// there is nothing extra to store or keep in sync.
const ticketRef = (id) => String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();

const SupportReply = (props) => {
  const { record, resource } = props;
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const sendNotice = useNotice();
  const { translateButton } = useTranslation();

  const closed = record?.params?.status !== 'OPEN';
  const notOurTurn = record?.params?.turn !== 'ADMIN';

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.recordAction({
        resourceId: resource.id,
        recordId: record.id,
        actionName: 'reply',
        data: { body },
      });
      if (res.data?.notice) sendNotice(res.data.notice);
      if (res.data?.redirectUrl) {
        window.location.assign(res.data.redirectUrl);
      }
    } catch (err) {
      sendNotice({ message: err.message || 'Reply failed', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Which ticket am I answering? Shown on every state, using the reference the
  // user quotes.
  const header = (
    <Box mb="lg">
      <Label>
        #{ticketRef(record?.params?.id)} — {record?.params?.subject || ''}
      </Label>
    </Box>
  );

  if (closed) {
    return (
      <Box variant="white">
        {header}
        <MessageBox variant="info" message="This ticket is closed." />
      </Box>
    );
  }
  if (notOurTurn) {
    return (
      <Box variant="white">
        {header}
        <MessageBox variant="info" message="Waiting for the user to reply — you can't send yet." />
      </Box>
    );
  }

  return (
    <Box variant="white">
      {header}
      <Label>Reply to the user</Label>
      <TextArea
        width={1}
        rows={5}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Type your reply…"
        disabled={busy}
      />
      <Box mt="lg">
        <Button variant="primary" onClick={submit} disabled={busy || !body.trim()}>
          {translateButton('sendReply', resource.id, { defaultValue: 'Send reply' })}
        </Button>
      </Box>
    </Box>
  );
};

export default SupportReply;
