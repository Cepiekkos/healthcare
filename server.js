const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8085;
const BASE_DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

function escapePdfText(value) {
    return String(value || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[^\x20-\x7E]/g, '?')
        .replace(/[\\()]/g, '\\$&');
}

function createPrescriptionPdf(prescription) {
    const textLine = (text, x, y, size, font = 'F1') =>
        `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET\n`;

    const lines = [
        textLine('AURAHEALTH', 50, 748, 20, 'F2'),
        textLine('PRESCRIPTION', 50, 720, 13, 'F2'),
        textLine('DEMO COPY - NOT VALID FOR DISPENSING', 50, 694, 10, 'F2'),
        'q 0.6 w 50 680 m 562 680 l S Q\n',
        textLine(`Prescription ID: ${prescription.rxNumber}`, 50, 654, 11, 'F2'),
        textLine(`Issue date: ${prescription.date || new Date().toISOString().slice(0, 10)}`, 50, 634, 10),
        textLine('PATIENT', 50, 594, 10, 'F2'),
        textLine(`Name: ${prescription.patientName}`, 50, 574, 11),
        textLine(`Patient ID: ${prescription.patientId}`, 50, 556, 10),
        textLine('MEDICATION', 50, 516, 10, 'F2'),
        textLine(prescription.medication, 50, 494, 13, 'F2'),
        textLine(`Instructions: ${prescription.dosage}`, 50, 468, 10),
        textLine(`Quantity: ${prescription.quantity || 'Not specified'}`, 50, 442, 10),
        textLine(`Refills: ${prescription.refills || '0'}`, 50, 424, 10),
        textLine(`Pharmacy: ${prescription.pharmacy || 'Not specified'}`, 50, 398, 10),
        textLine(`Prescriber: ${prescription.doctorName || 'Not specified'}`, 50, 372, 10),
        textLine(`Record status: ${prescription.status || 'Active'}`, 50, 354, 10),
        'q 0.6 w 50 328 m 562 328 l S Q\n',
        textLine('This PDF is generated from a local demonstration record.', 50, 304, 9),
        textLine('It is not a signed prescription and must not be used to dispense medication.', 50, 288, 9)
    ].join('');

    const streamLength = Buffer.byteLength(lines, 'ascii');
    const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 6 0 R >>\nendobj',
        '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj',
        `6 0 obj\n<< /Length ${streamLength} >>\nstream\n${lines}endstream\nendobj`
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach(object => {
        offsets.push(Buffer.byteLength(pdf, 'ascii'));
        pdf += `${object}\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, 'ascii');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'ascii');
}

const server = http.createServer((req, res) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

    if (req.url === '/bin/healthcare/export-prescription-pdf' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            let prescription;
            try {
                prescription = JSON.parse(body);
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid prescription data.' }));
                return;
            }

            const requiredFields = ['rxNumber', 'patientId', 'patientName', 'medication', 'dosage'];
            if (requiredFields.some(field => !String(prescription[field] || '').trim())) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Prescription is missing required fields.' }));
                return;
            }

            const pdf = createPrescriptionPdf(prescription);
            const safeRxNumber = String(prescription.rxNumber).replace(/[^a-zA-Z0-9_-]/g, '_');
            res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Length': pdf.length,
                'Content-Disposition': `attachment; filename="Prescription_${safeRxNumber}.pdf"`,
                'Cache-Control': 'no-store'
            });
            res.end(pdf);
        });
        return;
    }

    // Emulate AEM Sling Servlet POST /bin/healthcare/book-appointment
    if (req.url === '/bin/healthcare/book-appointment' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const code = 'APT-FHIR-' + Math.floor(100000 + Math.random() * 900000);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'CONFIRMED',
                confirmationCode: code,
                timestamp: new Date().toISOString(),
                fhirResource: 'Appointment/APT-' + code
            }));
        });
        return;
    }

    // Emulate AEM Sling Servlet GET /bin/healthcare/patient-records
    if (req.url.startsWith('/bin/healthcare/patient-records') && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            patientId: 'PAT-90821',
            fullName: 'Eleanor Vance',
            dob: '1988-04-12',
            gender: 'Female',
            bloodGroup: 'O+',
            primaryPhysician: 'Dr. Sarah Jenkins (Cardiology)'
        }));
        return;
    }

    // Emulate AEM Sling Servlet GET /bin/healthcare/export-ehr-pdf
    if (req.url.startsWith('/bin/healthcare/export-ehr-pdf')) {
        const urlParams = new URL(req.url, `http://${req.headers.host}`);
        const testName = urlParams.searchParams.get('test') || 'Diagnostic Report';
        const patientId = urlParams.searchParams.get('patientId') || 'PAT-90821';
        const filename = `EHR_${testName.replace(/[^a-zA-Z0-9]/g, '_')}_${patientId}.pdf`;

        // Generate a standard PDF document
        const stream = `BT
/F1 18 Tf
50 720 Td
(AURAHEALTH EMR - OFFICIAL CLINICAL DIAGNOSTIC REPORT) Tj
/F1 12 Tf
0 -40 Td
(Patient Name: Eleanor Vance  |  Patient ID: ${patientId}) Tj
0 -25 Td
(Date of Service: 2026-09-15  |  Verified By: Dr. Sarah Jenkins, MD) Tj
0 -30 Td
(Diagnostic Panel: ${testName}) Tj
0 -25 Td
(Clinical Findings: All metabolic markers within reference ranges. No acute abnormalities.) Tj
0 -25 Td
(Status: Verified & Signed via HL7 FHIR R4 DiagnosticReport Resource) Tj
ET`;
        const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length ${Buffer.byteLength(stream)} >>
stream
${stream}
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000228 00000 n 
0000000300 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${400 + Buffer.byteLength(stream)}
%%EOF`;

        res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`
        });
        res.end(pdf);
        return;
    }

    // Static file routing
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '/healthcare') {
        reqPath = '/login.html';
    }

    const filePath = path.join(BASE_DIR, reqPath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found: ' + req.url);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`Healthcare Management System server is active at http://localhost:${PORT}`);
});
