import { Router } from 'express';
import { getAgentState } from './agentTask';

export const driveRouter = Router();

const BACKUP_FILE_NAME = 'Price_Tracker_Products_Backup.json';

// Helper to get authorization token from header, body, or server state
function getAuthToken(req: any): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  if (req.body?.accessToken) {
    return req.body.accessToken;
  }
  const state = getAgentState();
  return state.googleToken || null;
}

// Search for the backup file on Google Drive
async function findBackupFileOnDrive(token: string): Promise<{ id: string; name: string; modifiedTime?: string } | null> {
  const query = encodeURIComponent(`name = '${BACKUP_FILE_NAME}' and trashed = false`);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime)`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err: any = new Error(`Google Drive API error (${response.status}): ${errorText}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return data.files[0];
  }
  return null;
}

// POST /api/drive/backup - Upload or update products backup on Google Drive
driveRouter.post('/backup', async (req, res) => {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Brak tokena dostępowego Google. Zaloguj się przez Google.' });
    }

    const { products } = req.body;
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: 'Produkty muszą być listą (array)' });
    }

    const jsonContent = JSON.stringify(products, null, 2);
    const existingFile = await findBackupFileOnDrive(token);

    if (existingFile) {
      // Update existing file content
      const updateRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: jsonContent,
        }
      );

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        return res.status(updateRes.status).json({ error: `Błąd aktualizacji pliku na Drive: ${errText}` });
      }

      const updatedFileData = await updateRes.json();
      return res.json({
        success: true,
        fileId: existingFile.id,
        updatedTime: new Date().toISOString(),
        count: products.length,
        message: 'Kopia zapasowa na Google Drive została zaktualizowana!',
      });
    } else {
      // Create new file with multipart upload
      const boundary = '-------PriceTrackerBoundary314159';
      const metadata = {
        name: BACKUP_FILE_NAME,
        mimeType: 'application/json',
      };

      const multipartBody =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        `${jsonContent}\r\n` +
        `--${boundary}--`;

      const createRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );

      if (!createRes.ok) {
        const errText = await createRes.text();
        return res.status(createRes.status).json({ error: `Błąd tworzenia pliku na Drive: ${errText}` });
      }

      const newFileData = await createRes.json();
      return res.json({
        success: true,
        fileId: newFileData.id,
        updatedTime: new Date().toISOString(),
        count: products.length,
        message: 'Utworzono nowy plik kopii zapasowej na Google Drive!',
      });
    }
  } catch (error: any) {
    console.error('Error in /api/drive/backup:', error);
    const statusCode = error.status || 500;
    return res.status(statusCode).json({ error: error.message || 'Nie udało się zapisać kopii na Google Drive' });
  }
});

// GET /api/drive/restore - Retrieve products backup from Google Drive
driveRouter.get('/restore', async (req, res) => {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Brak tokena dostępowego Google. Zaloguj się przez Google.' });
    }

    const existingFile = await findBackupFileOnDrive(token);
    if (!existingFile) {
      return res.status(404).json({ error: 'Nie znaleziono pliku kopii zapasowej (Price_Tracker_Products_Backup.json) na Twoim Google Drive.' });
    }

    // Download content
    const downloadRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${existingFile.id}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!downloadRes.ok) {
      const errText = await downloadRes.text();
      return res.status(downloadRes.status).json({ error: `Błąd pobierania pliku z Drive: ${errText}` });
    }

    const products = await downloadRes.json();
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: 'Plik na Google Drive nie zawiera poprawnej listy produktów.' });
    }

    return res.json({
      success: true,
      products,
      fileId: existingFile.id,
      modifiedTime: existingFile.modifiedTime,
      count: products.length,
      message: 'Pomyślnie pobrano produkty z Google Drive!',
    });
  } catch (error: any) {
    console.error('Error in /api/drive/restore:', error);
    const statusCode = error.status || 500;
    return res.status(statusCode).json({ error: error.message || 'Błąd przywracania z Google Drive' });
  }
});

// GET /api/drive/status - Check Drive backup status
driveRouter.get('/status', async (req, res) => {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.json({ connected: false, message: 'Google Auth not connected' });
    }

    const existingFile = await findBackupFileOnDrive(token);
    if (!existingFile) {
      return res.json({ connected: true, hasBackup: false, message: 'No Drive backup file yet' });
    }

    return res.json({
      connected: true,
      hasBackup: true,
      fileId: existingFile.id,
      modifiedTime: existingFile.modifiedTime,
    });
  } catch (error: any) {
    return res.json({ connected: false, error: error.message });
  }
});
