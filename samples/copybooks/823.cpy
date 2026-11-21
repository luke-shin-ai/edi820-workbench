      * NORTHWIND PAY - BANK SIDE 823 REMITTANCE CONFIRMATION (SYNTHETIC FIXTURE)
      * Fixed width: 80 bytes per record, line framing, ASCII transliteration.
      * Record types: 'D' = detail, 'T' = control trailer.
      * The amount's sign is a separate leading character ('+', '-' or space),
      * a different convention from the 820 file - the copybook decides, not the parser.
      *
      * @framing line
      * @semantics amount=AMOUNT currency=CURRENCY valueDate=VALUE-DATE dateFormat=CCYYMMDD reference=BANK-REF
      * @control typeField=REC-TYPE trailerValue=T countField=REC-COUNT totalField=AMOUNT currencyField=CURRENCY
      *
       01  BANK-RECORD.
           05  REC-TYPE            PIC X(1).
           05  ORIG-ID             PIC X(10).
           05  RECEIVER-ID         PIC X(10).
           05  CURRENCY            PIC X(3).
           05  AMOUNT              PIC S9(11)V99 SIGN LEADING SEPARATE.
           05  VALUE-DATE          PIC 9(8).
           05  BANK-REF            PIC X(15).
           05  REC-COUNT           PIC 9(6).
           05  FILLER              PIC X(13).
