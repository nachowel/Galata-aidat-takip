import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';

export class PDFService {
  static async openPDF(uri: string, fileName?: string): Promise<void> {
    try {
      console.log('PDF açılıyor:', uri, fileName);
      
      // Eğer uri varsa, Browser ile aç
      if (uri) {
        await Browser.open({ url: uri });
      } else {
        throw new Error('PDF URI bulunamadı');
      }
    } catch (error) {
      console.error('PDF açma hatası:', error);
      throw error;
    }
  }

  static async savePDF(base64Data: string, fileName: string): Promise<string> {
    try {
      const result = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents
      });
      
      console.log('PDF kaydedildi:', result.uri);
      return result.uri;
    } catch (error) {
      console.error('PDF kaydetme hatası:', error);
      throw error;
    }
  }

  static async sharePDF(uri: string, fileName: string): Promise<void> {
    try {
      await Share.share({
        title: fileName,
        url: uri,
        dialogTitle: 'PDF Paylaş'
      });
    } catch (error) {
      console.error('PDF paylaşma hatası:', error);
      throw error;
    }
  }
}
