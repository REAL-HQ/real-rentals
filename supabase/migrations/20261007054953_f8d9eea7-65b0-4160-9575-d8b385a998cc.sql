UPDATE public.automation_steps
   SET body = 'Hi {{first_name}}, REAL RENTALS here — your rental application is still open. Reply here if you''d like to finish it, or let us know if your plans changed. Reply STOP to opt out.'
 WHERE channel = 'sms' AND body LIKE '%Want us to hold one for you? Reply YES%';