import { Router } from 'express';

export const sheetsRouter = Router();

// Google Sheets: Create Spreadsheet
sheetsRouter.post('/create', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.accessToken;

    if (!token) {
      return res.status(401).json({ error: 'Google Access Token is required' });
    }

    const title = req.body.title || 'Product Price Tracker Agent Output';

    // Create spreadsheet using Google Sheets API
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title },
        sheets: [
          {
            properties: {
              title: 'Price Log',
              gridProperties: { frozenRowCount: 1 },
            },
          },
          {
            properties: {
              title: 'Daily History',
              gridProperties: { frozenRowCount: 1 },
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Google Sheets API error: ${errText}` });
    }

    const data = await response.json();
    const spreadsheetId = data.spreadsheetId;
    const spreadsheetUrl = data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    // Populate header row for Price Log
    const headers = [
      ['Product Title', 'Product URL', 'Current Price', 'Previous Price', 'Lowest Recorded', 'In Stock', 'Last Checked', 'Status'],
    ];

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Price Log!A1:H1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: headers }),
      }
    );

    // Populate header row for Daily History
    const historyHeaders = [
      ['Date', 'Product Title', 'Daily Lowest Price', 'Currency', 'Recorded At'],
    ];

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Daily History!A1:E1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: historyHeaders }),
      }
    ).catch(() => {});

    return res.json({
      spreadsheetId,
      title,
      url: spreadsheetUrl,
      message: 'Created new Google Sheet successfully!',
    });
  } catch (error: any) {
    console.error('Error in /api/sheets/create:', error);
    return res.status(500).json({ error: error.message || 'Failed to create spreadsheet' });
  }
});

// Google Sheets: Sync Products Data
sheetsRouter.post('/sync', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.accessToken;
    const { spreadsheetId, products } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'Google Access Token is required' });
    }
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Spreadsheet ID is required' });
    }
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: 'Products array is required' });
    }

    // 1. Fetch spreadsheet metadata to get the actual tab title (e.g. 'Price Log' or 'Sheet1')
    let mainSheetTitle = 'Price Log';
    let historySheetTitle = 'Daily History';
    let hasHistorySheet = false;

    try {
      const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (metaRes.ok) {
        const metaData = await metaRes.json();
        const sheetList = metaData.sheets || [];
        if (sheetList.length > 0 && sheetList[0]?.properties?.title) {
          mainSheetTitle = sheetList[0].properties.title;
        }
        const histSheet = sheetList.find((s: any) => s.properties?.title?.toLowerCase().includes('history'));
        if (histSheet?.properties?.title) {
          historySheetTitle = histSheet.properties.title;
          hasHistorySheet = true;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch spreadsheet metadata, falling back to default tab titles:', e);
    }

    const formatPriceStr = (val: any, curr: string) => {
      if (val === null || val === undefined || val === '') return 'N/A';
      const num = typeof val === 'number' ? val : parseFloat(val);
      if (isNaN(num)) return 'N/A';
      const formatted = num.toFixed(2);
      return curr === 'zł' || curr === 'PLN' ? `${formatted} zł` : `${curr}${formatted}`;
    };

    const rows = [
      ['Product Title', 'Product URL', 'Current Price', 'Previous Price', 'Lowest Recorded', 'In Stock', 'Last Checked', 'Status'],
      ...products.map((p: any) => {
        const currentP = p.currentPrice !== undefined ? p.currentPrice : null;
        const prevP = p.previousPrice !== undefined ? p.previousPrice : null;
        const lowestP = p.lowestPrice !== undefined ? p.lowestPrice : currentP;
        const curr = p.currency || 'zł';
        const isDrop = prevP !== null && currentP !== null && currentP < prevP;

        let lastCheckedStr = 'Never';
        if (p.lastChecked) {
          const d = new Date(p.lastChecked);
          lastCheckedStr = !isNaN(d.getTime()) ? d.toLocaleString() : String(p.lastChecked);
        }

        return [
          p.title || 'Bez nazwy',
          p.url || '',
          formatPriceStr(currentP, curr),
          prevP !== null ? formatPriceStr(prevP, curr) : 'N/A',
          formatPriceStr(lowestP, curr),
          p.inStock !== false ? 'Dostępny' : 'Brak w magazynie',
          lastCheckedStr,
          isDrop ? '📉 SPADEK CENY' : 'Stabilna',
        ];
      }),
    ];

    // 2. Clear entire main sheet content first so no stale leftover rows remain
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(mainSheetTitle + '!A1:Z2000')}:clear`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    ).catch(() => {});

    // 3. Write all rows cleanly
    const range = `${mainSheetTitle}!A1:H${rows.length}`;
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: rows }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Google Sheets sync error: ${errText}` });
    }

    // 4. Also sync Daily Lowest History Log if history exists
    if (hasHistorySheet) {
      const dailyHistoryRows = [
        ['Date', 'Product Title', 'Daily Lowest Price', 'Currency', 'Recorded At'],
      ];
      products.forEach((p: any) => {
        if (Array.isArray(p.priceHistory)) {
          p.priceHistory.forEach((pt: any) => {
            const dateStr = pt.timestamp ? (typeof pt.timestamp === 'string' ? pt.timestamp.split('T')[0] : 'N/A') : 'N/A';
            const priceNum = typeof pt.price === 'number' ? pt.price : parseFloat(pt.price);
            dailyHistoryRows.push([
              dateStr,
              p.title || 'Bez nazwy',
              !isNaN(priceNum) ? priceNum.toFixed(2) : '0.00',
              p.currency || 'zł',
              pt.timestamp ? (isNaN(new Date(pt.timestamp).getTime()) ? String(pt.timestamp) : new Date(pt.timestamp).toLocaleString()) : 'N/A',
            ]);
          });
        }
      });

      if (dailyHistoryRows.length > 1) {
        // Clear history sheet
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(historySheetTitle + '!A1:Z2000')}:clear`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        ).catch(() => {});

        const historyRange = `${historySheetTitle}!A1:E${dailyHistoryRows.length}`;
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(historyRange)}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: dailyHistoryRows }),
          }
        ).catch(() => {});
      }
    }

    return res.json({
      success: true,
      syncedCount: products.length,
      sheetTitle: mainSheetTitle,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/sheets/sync:', error);
    return res.status(500).json({ error: error.message || 'Failed to sync Google Sheet' });
  }
});

// Google Sheets: List existing sheets from Drive
sheetsRouter.get('/list', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.query.accessToken;

    if (!token) {
      return res.status(401).json({ error: 'Google Access Token is required' });
    }

    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'&fields=files(id,name,webViewLink,modifiedTime)&pageSize=15`;
    const response = await fetch(driveUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Drive API error: ${errText}` });
    }

    const data = await response.json();
    return res.json({ files: data.files || [] });
  } catch (error: any) {
    console.error('Error in /api/sheets/list:', error);
    return res.status(500).json({ error: error.message || 'Failed to list sheets' });
  }
});
