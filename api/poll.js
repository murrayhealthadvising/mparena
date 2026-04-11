const Imap = require('imap');
const { simpleParser } = require('mailparser');

function parseLeadEmail(text, html) {
  const raw = text || html || '';
  const get = (label) => {
    const m = raw.match(new RegExp(label + ':\\s*([^\\n\\r<]+)', 'i'));
    return m ? m[1].trim() : '';
  };
  return {
    id: 'l' + Date.now() + Math.random().toString(36).slice(2, 5),
    firstName: get('First Name'), lastName: get('Last Name'),
    phone: get('Primary Phone'), email: get('Email'),
    state: get('State'), zip: get('Zip'),
    age: get('Age'), ageRange: get('Age Range'),
    income: get('Income'), household: get('Household'),
    dob: get('DOB') || get('Date of Birth'),
    comments: get('Comments'), campaign: get('Name'),
    price: get('Price'), leadId: get('Lead Id'),
    receivedAt: new Date().toISOString(),
    disposition: 'new', notes: '', customDisp: ''
  };
}

function fetchNewLeads(addr, pass) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: addr, password: pass,
      host: 'imap.gmail.com', port: 993,
      tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 10000
    });
    const results = [];
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); return reject(err); }
        imap.search(['UNSEEN', ['FROM', 'leads@ushamarketplace.com']], (err, uids) => {
          if (err || !uids || !uids.length) { imap.end(); return resolve([]); }
          const fetch = imap.fetch(uids, { bodies: '', markSeen: true });
          fetch.on('message', (msg) => {
            let buffer = '';
            msg.on('body', (stream) => { stream.on('data', (chunk) => buffer += chunk.toString('utf8')); });
            msg.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                const lead = parseLeadEmail(parsed.text, parsed.textAsHtml);
                if (lead.firstName || lead.phone) results.push(lead);
              } catch(e) {}
            });
          });
          fetch.once('end', () => imap.end());
          fetch.once('error', () => { imap.end(); resolve(results); });
        });
      });
    });
    imap.once('end', () => resolve(results));
    imap.once('error', (err) => reject(err));
    imap.connect();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { addr, pass } = req.body;
  if (!addr || !pass) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const leads = await fetchNewLeads(addr, pass);
    res.status(200).json({ leads });
  } catch(err) {
    res.status(500).json({ error: 'Failed to connect', detail: err.message });
  }
};