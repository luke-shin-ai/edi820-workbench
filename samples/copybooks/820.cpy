      * NORTHWIND PAY - EDI 820 PAYMENT ORDER (SYNTHETIC FIXTURE - NOT REAL BANK DATA)
      * Fixed width: 100 bytes per record, line framing, ASCII transliteration.
      * Record types: 'P' = payment detail, 'T' = control trailer.
      * The amount's sign is a trailing overpunch on its last digit
      * ({ = +0, } = -0, A..I = +1..+9, J..R = -1..-9).
      * Debit/credit direction comes from TXN-TYPE, never from the sign alone.
      *
      * @framing line
      * @semantics amount=AMOUNT currency=CURRENCY valueDate=VALUE-DATE dateFormat=CCYYMMDD reference=REFERENCE transactionType=TXN-TYPE creditValue=C debitValue=D
      * @control typeField=REC-TYPE trailerValue=T countField=REC-COUNT totalField=AMOUNT currencyField=CURRENCY
      *
       01  PAYMENT-RECORD.
           05  REC-TYPE            PIC X(1).
           05  ORIG-ID             PIC X(10).
           05  RECEIVER-ID         PIC X(10).
           05  TXN-TYPE            PIC X(2).
           05  AMOUNT              PIC S9(11)V99 SIGN TRAILING OVERPUNCH.
           05  CURRENCY            PIC X(3).
           05  VALUE-DATE          PIC 9(8).
           05  REFERENCE           PIC X(15).
           05  REC-COUNT           PIC 9(6).
           05  FILLER              PIC X(32).
