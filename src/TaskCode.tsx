import { useState } from 'react';

import { HoverNote } from './HoverNote';

/**
 * Kod zadania, ktory kopiuje sie KLIKNIECIEM. Kopiujemy sam kod (IT-749), bo to
 * jego wkleja sie w nazwe galezi, tytul PR-a i commit — czyli w to, po czym
 * `bitrix_sync.py` rozpoznaje zadanie.
 *
 * Bez osobnego przycisku. Byl — ikonka obok kodu — ale kolumna kodu ma stala
 * szerokosc i od IT-1000 (a przy samym numerze zawsze) przycisk wystawal poza
 * nia i widac bylo jego skrawek. Poszerzanie kolumny przesuwalo kazdy tytul.
 * Klikniecie w sam kod nie zajmuje miejsca, a karta pod kursorem mowi, co sie
 * stanie, i potwierdza, ze sie stalo.
 *
 * Wspolny dla listy i tablicy: karta ma pokazywac to samo, co wiersz (parytet
 * widokow), a Board nie moze importowac z App.tsx — wyszedlby cykl importow.
 * To ten sam powod, dla ktorego `sumPoints` mieszka w taskView.ts.
 */
export function TaskCode({
  code,
  copy,
  onCopied,
}: {
  code: string;
  /**
   * Co ma trafic do schowka, gdy rozni sie od tego, co widac.
   *
   * Zadanie bez kodu IT pokazuje `#116213` — krzyzyk mowi "to numer, nie kod" — ale
   * wklejac trzeba samo `116213`: tyle przyjmuje wyszukiwarka Bitriksa i tyle wchodzi
   * w adres zadania. Z krzyzykiem kopia byla do niczego.
   */
  copy?: string;
  onCopied: (text: string) => void;
}) {
  /* `null` = schowek odmowil. Cisza znaczylaby wtedy „skopiowane". */
  const [done, setDone] = useState<boolean | null>(false);
  const text = copy ?? code;

  return (
    <HoverNote
      className="row-code"
      value={done === null ? 'Nie udało się skopiować' : done ? 'Skopiowano' : 'Kliknij, żeby skopiować'}
      note={text}
    >
      <span
        className="row-code-text"
        role="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          /* Klik w kod kopiuje — nie otwiera zadania, jak klik w reszte wiersza. */
          e.stopPropagation();
          void navigator.clipboard
            .writeText(text)
            .then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1200);
              onCopied(text);
            })
            .catch(() => {
              setDone(null);
              setTimeout(() => setDone(false), 1200);
              onCopied('');
            });
        }}
      >
        {code}
      </span>
    </HoverNote>
  );
}
