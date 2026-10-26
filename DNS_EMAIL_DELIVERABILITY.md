# 📧 Email Deliverability & Anti-Spam Configuration Guide (#18)

To guarantee that **TrashTrack Danao City** welcome credentials, OTP verifications, and password reset emails never land in Gmail, Yahoo, or Microsoft 365 spam folders, configure the following DNS records on your sending domain (`danao.gov.ph` or `trashtrack.gov.ph`):

---

## 1. Code-Level Anti-Spam Protections (Already Enabled)
In [`services/emailNotificationService.ts`](file:///e:/Capstone/TrashTruck/services/emailNotificationService.ts):
- **Multipart Plain-Text Fallback (`text` + `html`)**: Every HTML email automatically generates a clean plain-text body via `htmlToPlainText()`. HTML-only emails without a plain-text part are heavily penalized by SpamAssassin and Gmail.
- **Strict Header Sanitization**: `sanitizeHeader()` strips `\r` and `\n` to prevent SMTP header injection.
- **Official Reply-To & List-Unsubscribe Headers**: Every message includes `Reply-To: cenro@danao.gov.ph`, `X-Entity-Ref-ID`, `X-Auto-Response-Suppress: OOF, AutoReply`, and `List-Unsubscribe: <mailto:cicto@danao.gov.ph?subject=unsubscribe>`.

---

## 2. Required DNS Records (SPF, DKIM, DMARC)

### A. SPF (Sender Policy Framework) — TXT Record on `@`
Authorizes Firebase / Google Workspace / your SMTP relay to send mail on behalf of your domain:
```txt
Type: TXT
Host: @
Value: v=spf1 include:_spf.google.com include:_spf.firebasemail.com ~all
TTL: 3600
```

### B. DKIM (DomainKeys Identified Mail) — TXT Record
1. In **Google Workspace Admin** (or your transactional SMTP provider such as SendGrid / Resend / Brevo), generate a 2048-bit DKIM key for `trashtrack.gov.ph` / `danao.gov.ph`.
2. Publish the provider's TXT record:
```txt
Type: TXT
Host: google._domainkey
Value: v=DKIM1; k=rsa; p=<YOUR_2048_BIT_PUBLIC_KEY>
TTL: 3600
```

### C. DMARC (Domain-based Message Authentication, Reporting & Conformance) — TXT Record
Instructs receiving mail servers to trust SPF+DKIM aligned messages and send deliverability reports to CICTO:
```txt
Type: TXT
Host: _dmarc
Value: v=DMARC1; p=quarantine; pct=100; rua=mailto:cicto@danao.gov.ph; aspf=r; adkim=r
TTL: 3600
```

### D. Firebase Authentication Custom Email Domain
1. Open **Firebase Console → Authentication → Templates → Customize domain**.
2. Enter `trashtrack.gov.ph` (or `danao.gov.ph`) and add the two CNAME verification records provided by Firebase so password reset and email verification links originate directly from your official domain.

