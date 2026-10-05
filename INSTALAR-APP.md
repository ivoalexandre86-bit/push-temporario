# Instalar o Sistema de Gestão como app

O sistema é um PWA: instala direto pelo navegador, sem loja e sem APK.
Abra o endereço do sistema (o do Render, em **https://**) e siga os passos abaixo.

## iPhone / iPad
1. Abra o endereço no **Safari** (no iOS, só o Safari instala).
2. Toque em **Compartilhar** (quadrado com seta para cima).
3. Toque em **Adicionar à Tela de Início** > **Adicionar**.

## Android
1. Abra o endereço no **Chrome**.
2. Toque no menu **⋮** > **Instalar app** (ou **Adicionar à tela inicial**).
3. Confirme em **Instalar**.

## Computador (Chrome ou Edge)
1. Abra o endereço no Chrome ou no Edge.
2. Clique no **ícone de instalar** no fim da barra de endereço (monitor com seta)
   — ou menu **⋮** > **Instalar Sistema de Gestão de Projetos** / **Aplicativos > Instalar este site como aplicativo**.
3. O app abre em janela própria e ganha atalho no menu Iniciar.

## Importante
- **Precisa de HTTPS.** A instalação só aparece em endereços `https://`
  (ou `http://localhost` no próprio computador). O Render já entrega HTTPS.
  Pelo IP da rede local (ex.: `http://192.168.x.x`) o celular **não** oferece instalar.
- **Precisa de internet.** O app não funciona offline; sem conexão aparece a
  tela "Você está sem conexão".
- **Atualizações são automáticas**: cada deploy novo chega ao app instalado na
  próxima vez que ele for aberto (às vezes é preciso fechar e abrir de novo).
- O login continua o mesmo do navegador.
