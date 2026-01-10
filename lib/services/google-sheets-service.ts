import { google } from 'googleapis';
import { PlatformListingRequest, CreatePlatformListingRequest } from '../types/platform-request';

class GoogleSheetsService {
  private auth: InstanceType<typeof google.auth.JWT> | null = null;

  private getAuth() {
    if (!this.auth) {
      const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
      this.auth = new google.auth.JWT({
        email: process.env.GOOGLE_CLIENT_EMAIL,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
    return this.auth;
  }

  private getSheets() {
    return google.sheets({ version: 'v4', auth: this.getAuth() });
  }

  async appendPlatformRequest(data: CreatePlatformListingRequest): Promise<PlatformListingRequest> {
    const sheets = this.getSheets();
    const sheetId = process.env.GOOGLE_SHEET_COLAB_REQUEST_ID;

    if (!sheetId) {
      throw new Error('GOOGLE_SHEET_COLAB_REQUEST_ID is not configured');
    }

    // Check if headers exist, if not add them
    const existingData = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'A1:F1',
    });

    if (!existingData.data.values || existingData.data.values.length === 0) {
      const headers = ['Submitted At', 'Platform Name', 'Platform URL', 'Email', 'Twitter URL', 'Telegram URL'];
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'A1:F1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers],
        },
      });
    }

    const submitted_at = new Date().toISOString();

    const row = [
      submitted_at,
      data.platform_name,
      data.platform_url,
      data.email,
      data.twitter_url || '',
      data.telegram_url || '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'A:F',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row],
      },
    });

    return {
      submitted_at,
      ...data,
    };
  }
}

export const googleSheetsService = new GoogleSheetsService();
