import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

export const useBackButton = (
  activeTab: string,
  activeSubView: string | null,
  setActiveTab: (tab: any) => void,
  setActiveSubView: (view: string | null) => void
) => {
  useEffect(() => {
    const backButtonListener = CapacitorApp.addListener('backButton', () => {
      console.log('Geri tuşuna basıldı - activeTab:', activeTab, 'activeSubView:', activeSubView);
      
      // Eğer bir alt view açıksa, onu kapat
      if (activeSubView) {
        setActiveSubView(null);
        return;
      }
      
      // Eğer ana sayfa değilse, ana sayfaya dön
      if (activeTab !== 'home') {
        setActiveTab('home');
        return;
      }
      
      // Ana sayfadaysa, uygulamadan çık
      CapacitorApp.exitApp();
    });

    return () => {
      backButtonListener.remove();
    };
  }, [activeTab, activeSubView, setActiveTab, setActiveSubView]);
};
