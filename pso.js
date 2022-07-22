var nj = require("numjs");
const randy = require("randy");
const prompt = require("prompt-sync")({ sigint: true });

const n_iterations = prompt("Inform the number of iterations: ");
const target_error = prompt("Inform the target error: ");
const n_particles = prompt("Inform the number of particles: ");

const W = 0.5;
const c1 = 0.8;
const c2 = 0.9;

// particle class
class Particle {
  constructor() {
    this.position = nj.array([Math.random() * 50, Math.random() * 50]);
    this.pbest_position = this.position;
    this.pbest_value = Infinity;
    this.velocity = nj.array([0, 0]);
  }
  //Etat actuelle d'une particule
  particleState = () => {
    console.log(
      "I am at ",
      JSON.stringify(this.position),
      " my pbest is ",
      JSON.stringify(this.pbest_position)
    );
  };
  //methode pour changer la position d'une particule
  move() {
    const newPosition = nj.array([
      this.position.get(0) + this.velocity.get(0),
      this.position.get(1) + this.velocity.get(1),
    ]);
    this.position = newPosition;
  }
}

//  Space Class
class Space {
  constructor(target, target_error, n_particles) {
    this.target = target;
    this.target_error = target_error;
    this.n_particles = n_particles;
    this.particles = [];
    this.gbest_value = 0;
    this.gbest_position = nj.array([Math.random() * 50, Math.random() * 50]);
  }

  //methode qui affiche toutes les particules
  displayParticles = () => {
    this.particles.map((particle) => {
      particle.particleState();
    });
  };

  // our optimization function
  fitness(particle) {
    return particle.position.get(0) + particle.position.get(1) + 1;
  }

  setPbest() {
    this.particles.map((particle) => {
      let fitness_cadidate = this.fitness(particle);
      if (particle.pbest_value < fitness_cadidate) {
        particle.pbest_value = fitness_cadidate;
        particle.pbest_position = particle.position;
      }
    });
  }
  setGbest() {
    this.particles.map((particle) => {
      let best_fitness_cadidate = this.fitness(particle);
      if (this.gbest_value < best_fitness_cadidate) {
        this.gbest_value = best_fitness_cadidate;
        this.gbest_position = particle.position;
      }
    });
  }

  moveParticles() {
    this.particles.map((particle) => {
      let new_velocity =
        W * particle.velocity.get(0) +
        c1 * Math.random() * (particle.pbest_position - particle.position) +
        Math.random() * c2 * (this.gbest_position - particle.position);
      particle.velocity = nj.array([new_velocity, new_velocity]);
      particle.move();
    });
  }
}

const search_space = new Space(Infinity, target_error, n_particles);
let currentParticles = [];
for (let i = 0; i < search_space.n_particles; i++) {
  currentParticles.push(new Particle());
}
const particles_vector = currentParticles;
search_space.particles = particles_vector;
search_space.displayParticles();

let iteration = 0;
while (iteration < n_iterations) {
  search_space.setPbest();
  search_space.setGbest();
  if (
    Math.abs(search_space.gbest_value - search_space.target) <=
    search_space.target_error
  ) {
    break;
  }
  search_space.moveParticles();
  iteration += 1;
}

console.log(
  "The best solution is: ",
  JSON.stringify(search_space.gbest_position),
  " in n_iterations: ",
  JSON.stringify(iteration)
);

// const search_space = new Space(target, target_error, n_particles);

// target = inifity

// target_error = target error to break

// n_partiles = number of bots

// z best bot in the network

// z = x + y + c

// minimal value is 1 so c =1

// x = trustrate {value creation + reputation}

// y = number of bot connexions
