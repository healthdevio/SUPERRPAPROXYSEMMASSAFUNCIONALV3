const puppeteer = require('puppeteer');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
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

async function initBrowser() {
  console.log('1.0.1 [Browser] Iniciando o navegador...');
  const browser = await puppeteer.launch({
    args: [
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
  console.log('1.0.2 [Browser] Navegador iniciado com sucesso.');
  return browser;
}

async function fetchVoterData({ cpf, birthDate, motherName }, browser) {
  console.log('1.0.3 Entrou no fetch voter data');
  const page = await browser.newPage();

  try {
    console.log('1.0.4 [RPA] Acessando o site do TRE-CE...');
    await page.goto(
      'https://www.tre-ce.jus.br/servicos-eleitorais/titulo-e-local-de-votacao/consulta-por-nome',
      {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      },
    );
    console.log('1.0.5 [RPA] Site acessado com sucesso.');

    // Espera de 5 segundos
    await new Promise((resolve) => setTimeout(resolve, 5000));

    await page.waitForSelector('.cookies .botao button', {
      visible: true,
      timeout: 5000,
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
      timeout: 5000,
    });

    await page.type('[formcontrolname=TituloCPFNome]', formattedCpf);
    console.log(`CPF preenchido: ${formattedCpf}`);

    await page.waitForSelector('[formcontrolname=dataNascimento]', {
      visible: true,
      timeout: 5000,
    });
    await page.type('[formcontrolname=dataNascimento]', formattedBirthDate);
    console.log(`Data de nascimento preenchida: ${formattedBirthDate}`);

    await page.waitForSelector('[formcontrolname=nomeMae]', {
      visible: true,
      timeout: 6000,
    });
    await page.type(
      '[formcontrolname=nomeMae]',
      normalize(motherName.toUpperCase()),
    );
    console.log(
      `Nome da mãe preenchido: ${normalize(motherName.toUpperCase())}`,
    );

    await page.waitForSelector('.btn-tse', {
      visible: true,
      timeout: 6000,
    });
    const button = await page.$('.btn-tse');
    if (button) {
      await page.evaluate((b) => b.click(), button);
      console.log(`Submetendo formulário para CPF: ${formattedCpf}`);
    } else {
      throw new Error('Botão de submissão não encontrado');
    }

    console.log('[FORM]: Formulário submetido');

    // Espera de 5 segundos
    await new Promise((resolve) => setTimeout(resolve, 5000));

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
      // const screenshotDir = path.join(__dirname, 'rpa');
      // if (!fs.existsSync(screenshotDir)) {
      //   fs.mkdirSync(screenshotDir, { recursive: true });
      // }

      const timestamp = new Date().toISOString();
      // const screenshotPath = path.join(
      //   screenshotDir,
      //   `erro_${cpf.replace(/\s+/g, '_')}_${timestamp}.png`,
      // );
      // await page.screenshot({ path: screenshotPath });
      // console.error(
      //   `[${timestamp}] 1.2.4 [RPA] Erro ao processar CPF: ${cpf} - ${data.message}`,
      // );
      throw new Error(data.message);
    }
    console.log(
      `1.2.3 [RPA] Dados obtidos com sucesso para CPF: ${formattedCpf}`,
    );
    return data.data;
  } catch (error) {
    // const screenshotDir = path.join(__dirname, 'rpa');
    // if (!fs.existsSync(screenshotDir)) {
    //   fs.mkdirSync(screenshotDir, { recursive: true });
    // }

    const timestamp = new Date().toISOString();
    // const screenshotPath = path.join(
    //   screenshotDir,
    //   `erro_${cpf.replace(/\s+/g, '_')}_${timestamp}.png`,
    // );
    // await page.screenshot({ path: screenshotPath });
    // console.error(
    //   `[${timestamp}] 1.2.4 [RPA] Erro ao processar CPF: ${cpf} - ${error.message}`,
    // );
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
      WHERE contract_id = '49e33fac-7e97-4d86-8cc3-1bc66e0ffa11'
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

    console.log(`1.3.2 [DB] Total de apoiadores encontrados: ${totalSupporters}`);

    const concurrencyLimit = 5; // Ajuste conforme necessário
    const queue = supporters.slice();

    async function worker() {
      const browser = await initBrowser();
      try {
        while (queue.length > 0) {
          const supporter = queue.shift();
          totalProcessed++;
          const { birthday, mother_name: motherName, cpf } = supporter;
          console.log(`1.3.4 [Processo] Processando CPF: ${cpf}...`);

          try {
            const data = await fetchVoterData(
              {
                cpf,
                birthDate: birthday,
                motherName,
              },
              browser,
            );
            console.log(
              `1.3.5 [Processo] Dados obtidos para CPF: ${cpf}:`,
              data,
            );
            await updateSupporterData(cpf, data);
            totalSuccess++;
          } catch (error) {
            const timestamp = new Date().toISOString();
            console.error(
              `[${timestamp}] 1.4.0 [Processo] Erro ao buscar dados para CPF: ${cpf} (Data de nascimento: ${birthday}, Nome da mãe: ${motherName}):`,
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
