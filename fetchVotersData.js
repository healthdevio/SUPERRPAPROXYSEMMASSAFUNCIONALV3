const puppeteer = require('puppeteer-extra');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const userAgents = require('user-agents');

puppeteer.use(StealthPlugin());

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanType(page, selector, text, typos = true) {
  await page.focus(selector);

  for (let i = 0; i < text.length; i++) {
    await new Promise(resolve => setTimeout(resolve, randomDelay(100, 300)));

    if (typos && Math.random() < 0.1 && i > 0) { 
      const typoChar = String.fromCharCode(97 + Math.floor(Math.random() * 26)); 
      await page.keyboard.type(typoChar);
      await new Promise(resolve => setTimeout(resolve, randomDelay(100, 300)));
      await page.keyboard.press('Backspace');
    }

    await page.keyboard.type(text[i]);
  }

  if (typos && Math.random() < 0.2) { 
    const extraChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
    await page.keyboard.type(extraChar);
    await new Promise(resolve => setTimeout(resolve, randomDelay(100, 300)));
    await page.keyboard.press('Backspace');
  }
}

function formatDate(birthday) {
  console.log(`Formato original da data de nascimento: ${birthday} (Tipo: ${typeof birthday})`);

  if (!birthday) return '';

  let day, month, year;

  if (typeof birthday === 'string') {
    if (birthday.includes('/')) {
      const parts = birthday.split('/');
      if (parts.length !== 3) {
        throw new Error(`Formato de data inválido: ${birthday}`);
      }
      [day, month, year] = parts;
    } else if (birthday.includes('-')) {
      const parts = birthday.split('-');
      if (parts.length !== 3) {
        throw new Error(`Formato de data inválido: ${birthday}`);
      }
      [year, month, day] = parts;
    } else {
      throw new Error(`Formato de data desconhecido: ${birthday}`);
    }
  } else if (birthday instanceof Date) {
    day = String(birthday.getDate()).padStart(2, '0');
    month = String(birthday.getMonth() + 1).padStart(2, '0');
    year = birthday.getFullYear();
  } else {
    throw new Error('Formato de data não suportado');
  }

  if (!day || !month || !year) {
    throw new Error(`Componentes da data inválidos: ${birthday}`);
  }

  const formattedDate = `${day}/${month}/${year}`;
  console.log(`Data de nascimento formatada: ${formattedDate}`);
  return formattedDate;
}

function formatCpf(cpf) {
  return cpf.replace(/\D/g, '');
}

function normalize(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const dbClient = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT),
  ssl: {
    rejectUnauthorized: false,
  },
});

const fortalezaLocations = [
  { latitude: -3.71722, longitude: -38.5434 }, // Centro de Fortaleza
  { latitude: -3.73053, longitude: -38.5233 }, // Praia de Iracema
  { latitude: -3.74935, longitude: -38.5238 }, // Beira Mar
  { latitude: -3.7941, longitude: -38.4939 },  // Aldeota
  { latitude: -3.83935, longitude: -38.5744 }, // Messejana
  { latitude: -3.72631, longitude: -38.4766 }, // Benfica
];

function getRandomFortalezaLocation() {
  return fortalezaLocations[Math.floor(Math.random() * fortalezaLocations.length)];
}

async function setGeolocation(page) {
  const randomLocation = getRandomFortalezaLocation();
  await page.setGeolocation({
    latitude: randomLocation.latitude,
    longitude: randomLocation.longitude
  });
  console.log(`Geolocalização definida para: Lat ${randomLocation.latitude}, Long ${randomLocation.longitude}`);
}

async function initBrowser() {
  console.log('1.0.1 [Browser] Iniciando o navegador...');

  const resolutions = [
    { width: 2560, height: 1440 },
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ];

  const resolution = resolutions[Math.floor(Math.random() * resolutions.length)];

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--window-size=${resolution.width},${resolution.height}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--incognito',
      '--enable-blink-features=HTMLImports',
    ],
    waitForInitialPage: false,
  });
  
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://www.tre-ce.jus.br', ['geolocation']);

  await browser.on('targetcreated', async (target) => {
    const page = await target.page();
    if (page) {
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });

        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) return 'Intel Inc.';
          if (parameter === 37446) return 'Intel Iris OpenGL Engine'; 
          return getParameter(parameter);
        };

        Object.defineProperty(navigator, 'languages', {
          get: () => ['pt-BR', 'pt', 'en-US'],
        });

        Object.defineProperty(navigator, 'language', {
          get: () => 'pt-BR',
        });

        HTMLCanvasElement.prototype.toDataURL = function(type, ...args) {
          const original = HTMLCanvasElement.prototype.toDataURL;
          return original.call(this, type, ...args);
        };

        const originalError = console.error;
        console.error = function(message) {
          if (message.includes('error')) return;
          originalError.apply(console, arguments);
        };
      });
    }
  });

  console.log(`1.0.2 [Browser] Navegador iniciado com sucesso com resolução ${resolution.width}x${resolution.height}.`);
  return browser;
}

async function fetchVoterData({ cpf, birthDate, motherName }, browser) {
  console.log('1.0.3 Entrou no fetch voter data');

  const page = await browser.newPage();
  await setGeolocation(page);

  const viewport = browser.wsEndpoint().match(/--window-size=(\d+),(\d+)/);
  if (viewport) {
    await page.setViewport({
      width: parseInt(viewport[1]),
      height: parseInt(viewport[2]),
    });
  }


  await page.setUserAgent(new userAgents().random().toString());

  try {
    console.log('1.0.4 [RPA] Acessando o site do TRE-CE...');
    await page.goto(
      'https://www.tre-ce.jus.br/servicos-eleitorais/titulo-e-local-de-votacao/consulta-por-nome',
      {
        waitUntil: 'networkidle2',
        timeout: 120000,
      },
    );
    console.log('1.0.5 [RPA] Site acessado com sucesso.');

    await new Promise((resolve) => setTimeout(resolve, randomDelay(4000, 9000)));

    await page.waitForSelector('.cookies .botao button', {
      visible: true,
      timeout: randomDelay(4000, 9000),
    });
    const cienteButton = await page.$('div.botao button.btn');
    if (cienteButton) {
      await cienteButton.click();
      console.log('Pop-up de cookies fechado.');
    } else {
      console.log('Botão "Ciente" não encontrado.');
    }

    const modalButton = await page.$('app-menu-option[title="8. Onde votar"]');
    if (modalButton) {
      await modalButton.click();
      console.log('Modal do Formulário aberto.');
    } else {
      console.log('Botão "Onde votar" não encontrado.');
    }

    const formattedBirthDate = formatDate(birthDate);
    console.log(`Data de nascimento formatada: ${formattedBirthDate}`);
    const formattedCpf = formatCpf(cpf);
    console.log(`1.1.2 [RPA] CPF formatado: ${formattedCpf}`);
    console.log(
      `1.1.3 [RPA] Data de nascimento formatada: ${formattedBirthDate}`,
    );

    await page.waitForSelector('[formcontrolname=TituloCPFNome]', {
      visible: true,
      timeout: randomDelay(4000, 9000),
    });

    await humanType(page, '[formcontrolname=TituloCPFNome]', formattedCpf, false);
    console.log(`CPF preenchido: ${formattedCpf}`);    

    await page.waitForSelector('[formcontrolname=dataNascimento]', {
      visible: true,
      timeout: randomDelay(4000, 9000),
    });
    await humanType(page, '[formcontrolname=dataNascimento]', formattedBirthDate, false);
    console.log(`Data de nascimento preenchida: ${formattedBirthDate}`);

    const dateFieldValue = await page.$eval('[formcontrolname=dataNascimento]', el => el.value.trim());
    if (dateFieldValue !== formattedBirthDate) {
      throw new Error('Data de nascimento não preenchida corretamente.');
    }

    await page.waitForSelector('[formcontrolname=nomeMae]', {
      visible: true,
      timeout: randomDelay(4000, 9000),
    });
    await humanType(
      page,
      '[formcontrolname=nomeMae]',
      normalize(motherName.toUpperCase()),
      true, 
    );
    console.log(
      `Nome da mãe preenchido: ${normalize(motherName.toUpperCase())}`,
    );

    await page.waitForSelector('.btn-tse', {
      visible: true,
      timeout: randomDelay(4000, 9000),
    });
    const button = await page.$('.btn-tse');
    if (button) {
      const boundingBox = await button.boundingBox();
      if (boundingBox) {
        await page.mouse.move(
          boundingBox.x + boundingBox.width / 2,
          boundingBox.y + boundingBox.height / 2,
          { steps: 10 },
        );
        await page.mouse.click(
          boundingBox.x + boundingBox.width / 2,
          boundingBox.y + boundingBox.height / 2,
          { delay: randomDelay(3000, 9000) },
        );
        console.log(`Submetendo formulário para CPF: ${cpf}`);
      } else {
        throw new Error('Não foi possível obter as coordenadas do botão');
      }
    } else {
      throw new Error('Botão de submissão não encontrado');
    }

    console.log('[FORM]: Formulário submetido');

    await new Promise((resolve) => setTimeout(resolve, 6000 + Math.random() * 3000));

    const data = await page.evaluate(() => {
      const voterComponent = document.querySelector('.componente-onde-votar');
      if (!voterComponent) {
        return {
          error: true,
          message: 'Pessoa não encontrada no sistema do TRE',
        };
      }

      const labels = Array.from(
        document.querySelectorAll('.lado-ov .data-box .label'),
      ).map((el) => el.textContent.trim() ?? null);
      const descs = Array.from(
        document.querySelectorAll('.lado-ov .data-box .desc'),
      ).map((el) => el.textContent.trim() ?? null);

      const result = {};
      const possibleLabels = {
        'Local de votação': 'local',
        Endereço: 'endereco',
        'Município/UF': 'municipio',
        Bairro: 'bairro',
        Seção: 'secao',
        País: 'pais',
        Zona: 'zona',
      };

      labels.forEach((label, i) => {
        const key = possibleLabels[label];
        if (key) {
          result[key] = descs[i] || null;
        }
      });

      result.biometria = document.body.innerText.includes(
        'ELEITOR/ELEITORA COM BIOMETRIA COLETADA',
      );

      return { error: false, data: result };
    });

    if (data.error) {
      const screenshotDir = path.join(__dirname, 'rpa');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }

      const timestamp = new Date().toISOString();
      const screenshotPath = path.join(
        screenshotDir,
        `erro_${cpf.replace(/\s+/g, '_')}_${timestamp}.png`,
      );
      await page.screenshot({ path: screenshotPath });
      console.error(
        `[${timestamp}] 1.2.4 [RPA] Erro ao processar CPF: ${cpf} - ${data.message}`,
      );
      throw new Error(data.message);
    }
    console.log(
      `1.2.3 [RPA] Dados obtidos com sucesso para CPF: ${cpf}`,
    );
    return data.data;
  } catch (error) {
    const screenshotDir = path.join(__dirname, 'rpa');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const screenshotPath = path.join(
      screenshotDir,
      `erro_${cpf.replace(/\s+/g, '_')}_${timestamp}.png`,
    );
    await page.screenshot({ path: screenshotPath });
    console.error(
      `[${timestamp}] 1.2.4 [RPA] Erro ao processar CPF: ${cpf} - ${error.message}`,
    );
    throw error;
  } finally {
    await page.close();
    console.log('1.2.5 [RPA] Página fechada.');
  }
}

async function getSupportersFromDatabase() {
  console.log('1.3.0 Entrou na função de banco');

  try {
    console.log('1.3.2 [DB] Dados consultados do banco com sucesso.');

    const query = `
      SELECT cpf, mother_name, birthday
      FROM supporters
      WHERE contract_id = '5092d795-e184-407a-9e4a-cd853dafd83c'
        AND mother_name IS NOT NULL
        AND birthday IS NOT NULL
        AND cpf IS NOT NULL
        AND (rpa_filled IS NULL OR rpa_filled = FALSE)
        AND (preenchidorpa IS NULL OR preenchidorpa = FALSE)
    `;

    const result = await dbClient.query(query);

    return result.rows;
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] 1.3.3 [DB] Erro ao consultar o banco:`, error);
    throw error;
  }
}

async function updateSupporterData(cpf, data) {
  try {
    const query = `
      UPDATE supporters
      SET local_voting = $1,
          voting_address = $2,
          voting_city = $3,
          neighborhood = $4,
          session = $5,
          voting_zone = $6,
          biometry = $7,
          rpa_filled = TRUE,
          preenchidorpa = TRUE
      WHERE cpf = $8
    `;

    const values = [
      data.local || null,
      data.endereco || null,
      data.municipio || null,
      data.bairro || null,
      data.secao || null,
      data.zona || null,
      data.biometria || false,
      cpf,
    ];

    await dbClient.query(query, values);
    console.log(`1.3.6 [DB] Dados atualizados para CPF: ${cpf}`);
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(
      `[${timestamp}] 1.3.7 [DB] Erro ao atualizar dados para CPF: ${cpf} - ${error.message}`,
    );
  }
}

async function processSupporters() {
  console.log('1.3.3 Entrou no processSupporters');

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailures = 0;

  try {
    await dbClient.connect();
    console.log('1.3.1 [DB] Conectado ao banco de dados.');

    const supporters = await getSupportersFromDatabase();

    const totalSupporters = supporters.length;

    console.log(
      `1.3.2 [DB] Total de apoiadores encontrados: ${totalSupporters}`,
    );

    const concurrencyLimit = 4;
    const queue = supporters.slice();

    async function worker() {
      const browser = await initBrowser();
      try {
        while (queue.length > 0) {
          const supporter = queue.shift();
          totalProcessed++;
          const { birthday, mother_name: motherName, cpf } = supporter;

          let formattedCpf, formattedBirthDate, formattedMotherName;
          try {
            formattedCpf = formatCpf(cpf);
            formattedBirthDate = formatDate(birthday);
            formattedMotherName = normalize(motherName.toUpperCase());
          } catch (formatError) {
            const timestamp = new Date().toISOString();
            console.error(
              `[${timestamp}] 1.4.1 [Processo] Erro ao formatar dados para CPF: ${cpf} (Data de nascimento: ${birthday}, Nome da mãe: ${motherName}):`,
              formatError.message,
            );
            totalFailures++;
            continue;
          }

          console.log(`1.3.4 [Processo] Processando CPF: ${formattedCpf}...`);

          try {
            const data = await fetchVoterData(
              {
                cpf: formattedCpf,
                birthDate: formattedBirthDate,
                motherName: formattedMotherName,
              },
              browser,
            );
            console.log(
              `1.3.5 [Processo] Dados obtidos para CPF: ${formattedCpf}:`,
              data,
            );
            await updateSupporterData(formattedCpf, data);
            totalSuccess++;
          } catch (error) {
            const timestamp = new Date().toISOString();
            console.error(
              `[${timestamp}] 1.4.0 [Processo] Erro ao buscar dados para CPF: ${formattedCpf} (Data de nascimento: ${formattedBirthDate}, Nome da mãe: ${formattedMotherName}):`,
              error.message,
            );
            totalFailures++;
          }

          const successPercentage = (
            (totalSuccess / totalProcessed) *
            100
          ).toFixed(2);
          const failurePercentage = (
            (totalFailures / totalProcessed) *
            100
          ).toFixed(2);
          const pending = totalSupporters - totalProcessed;
          const pendingPercentage = (
            (pending / totalSupporters) *
            100
          ).toFixed(2);

          process.stdout.write(
            `\rProcessados: ${totalProcessed}/${totalSupporters} | Sucesso: ${totalSuccess} (${successPercentage}%) | Falha: ${totalFailures} (${failurePercentage}%) | Pendentes: ${pending} (${pendingPercentage}%)`,
          );

          await new Promise(resolve => setTimeout(resolve, randomDelay(5000, 10000)));
        }
      } finally {
        await browser.close();
        console.log('1.2.5 [RPA] Navegador fechado.');
      }
    }

    const workers = [];
    for (let i = 0; i < concurrencyLimit; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    console.log(`\n1.5.0 [Processo] Total processados: ${totalProcessed}`);
    console.log(`1.5.1 [Processo] Total com sucesso: ${totalSuccess}`);
    console.log(`1.5.2 [Processo] Total com falhas: ${totalFailures}`);
    console.log(
      `1.5.4 [Processo] Total pendentes: ${totalSupporters - totalProcessed}`,
    );
  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [Processo] Erro no processo:`, error);
  } finally {
    await dbClient.end();
    console.log('1.5.3 [DB] Conexão com o banco fechada.');
  }
}

processSupporters();
