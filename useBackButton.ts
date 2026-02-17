import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

export const useBackButton = (
  activeTab: string,
  activeSubView: string | null,
  setActiveTab: (tab: any) => void,
  setActiveSubView: (view: string | null) => void
) => {
  useEffect(() => {
    let listenerHandle: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;

    CapacitorApp.addListener('backButton', () => {
      console.log('Geri tuşuna basıldı - activeTab:', activeTab, 'activeSubView:', activeSubView);

      if (activeSubView) {
        setActiveSubView(null);
        return;
      }

      if (activeTab !== 'home') {
        setActiveTab('home');
        return;
      }

      CapacitorApp.exitApp();
    }).then((handle) => {
      listenerHandle = handle;
    });

    return () => {
      listenerHandle?.remove();
    };
  }, [activeTab, activeSubView, setActiveTab, setActiveSubView]);
};
