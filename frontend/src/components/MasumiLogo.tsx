import React from 'react';
import masumiBlack from '@/assets/masumi-logo-black.svg';
import masumiWhite from '@/assets/Masumi white.svg';
import { useTheme } from '@/lib/contexts/ThemeContext';
import Image from 'next/image';
import kanjiWhite from '@/assets/Masumi kanji white.svg';
import kanjiBlack from '@/assets/Kanji.svg';
const MasumiLogo = () => {
  const { theme } = useTheme();
  return (
    <div className="flex items-end justify-center gap-4">
      <Image
        src={theme === 'dark' ? masumiWhite : masumiBlack}
        alt="Masumi Logo"
        width={120}
        height={32}
      />
      <Image src={theme === 'dark' ? kanjiWhite : kanjiBlack} alt="Kanji" />
    </div>
  );
};

export default MasumiLogo;
